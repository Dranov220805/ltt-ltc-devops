require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH || '.env',
  override: false
});
const path = require('path');
const fs = require('fs');
const s3 = require('./services/s3');

/** Must run before routes load multer (disk vs memory). Read-only container FS without S3 would throw here otherwise. */
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(publicDir, 'uploads');
if (!s3.s3Enabled()) {
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  } catch (err) {
    process.env.FORCE_MEMORY_UPLOADS = 'true';
    console.warn(
      `Uploads directory not writable (${err.code || 'ERR'}): ${err.message}. Using memory-only multipart handling; image bytes are not persisted without S3_BUCKET or a writable volume at ${uploadsDir}.`
    );
  }
}

const express = require('express');
const mongoose = require('mongoose');
const os = require('os');
const productRoutes = require('./routes/productRoutes');
const dataSource = require('./services/dataSource');
const uiRoutes = require('./routes/uiRoutes');
const runtimeInfo = require('./services/runtimeInfo');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/** Set true after dataSource.init completes — used by Kubernetes readiness probe */
let appReady = false;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', (req, res) => {
  if (!appReady) {
    return res.status(503).json({ status: 'starting' });
  }
  res.status(200).json({ status: 'ready' });
});

// view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

if (s3.s3Enabled()) {
  app.use('/uploads', (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }
    const m = req.originalUrl.match(/^\/uploads\/([^?]+)/);
    const raw = m ? m[1] : '';
    const name = decodeURIComponent(raw.replace(/^\/+/, ''));
    if (!name || name.includes('..')) {
      return res.status(400).send('Bad path');
    }
    return s3.streamUploadToResponse(name, res).catch(next);
  });
}

app.use(express.static(publicDir));

const PORT = Number(process.env.PORT) || 3000;

const allowInMemoryFallback =
  String(process.env.ALLOW_IN_MEMORY_FALLBACK || 'true').toLowerCase() !== 'false';

/**
 * Attach Redis-backed sessions when REDIS_URL and SESSION_SECRET are set.
 * On failure, logs and continues without Redis (app stays up).
 * @param {import('express').Express} expressApp
 */
async function attachRedisSessionIfConfigured(expressApp) {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  const sessionSecret = String(process.env.SESSION_SECRET || '').trim();
  if (!redisUrl || !sessionSecret) {
    runtimeInfo.setRedisUnset();
    return;
  }

  const session = require('express-session');
  const RedisStore = require('connect-redis').default;
  const Redis = require('ioredis');

  const connectTimeout = Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 15000;
  const readyTimeout = Number(process.env.REDIS_READY_TIMEOUT_MS) || 15000;

  let redisClient;
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout,
      retryStrategy(times) {
        return Math.min(times * 400, 5000);
      }
    });

    await Promise.race([
      new Promise((resolve, reject) => {
        redisClient.once('ready', resolve);
        redisClient.once('error', reject);
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Redis ready timeout')), readyTimeout);
      })
    ]);
  } catch (err) {
    console.warn(`Redis session disabled (${err.message}) — continuing without Redis store.`);
    if (redisClient) {
      redisClient.disconnect();
    }
    runtimeInfo.setRedisUnavailable(runtimeInfo.summarizeRedisUrl(redisUrl), err.message);
    return;
  }

  runtimeInfo.attachRedisSessionClient(redisClient, runtimeInfo.summarizeRedisUrl(redisUrl));

  const secureCookie =
    String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true' ||
    process.env.NODE_ENV === 'production';

  expressApp.use(
    session({
      store: new RedisStore({ client: redisClient }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'sid',
      cookie: {
        secure: secureCookie,
        httpOnly: true,
        maxAge: Number(process.env.SESSION_MAX_AGE_MS) || 86400000
      }
    })
  );
}

/**
 * @param {string} uri
 * @returns {import('mongoose').ConnectOptions}
 */
function mongooseConnectOptions(uri) {
  const serverSelectionTimeoutMS =
    Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 45000;
  if (uri.startsWith('mongodb+srv://')) {
    return {
      serverSelectionTimeoutMS,
      serverApi: { version: '1', strict: true, deprecationErrors: true }
    };
  }
  const caPath = String(process.env.DOCUMENTDB_TLS_CA_PATH || process.env.MONGO_TLS_CA_FILE || '').trim();
  const useTls =
    String(process.env.MONGO_TLS || '').toLowerCase() === 'true' || Boolean(caPath);
  if (useTls && uri.startsWith('mongodb://')) {
    /** @type {import('mongoose').ConnectOptions} */
    const opts = {
      serverSelectionTimeoutMS,
      tls: true,
      retryWrites: false
    };
    if (caPath) {
      opts.tlsCAFile = caPath;
    }
    return opts;
  }
  return { serverSelectionTimeoutMS };
}

/**
 * Fails early with a clear message when .env is wrong (common: @ in password not encoded).
 * @param {string} uri
 */
function assertMongoUriLooksValid(uri) {
  if (/<\s*db_password\s*>/i.test(uri) || /<\s*password\s*>/i.test(uri)) {
    throw new Error(
      'MONGO_URI still contains a <password> placeholder — replace with your real Atlas password (URL-encode @ # / : % +)'
    );
  }
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('MONGO_URI must start with mongodb:// or mongodb+srv://');
  }
  if (uri.startsWith('mongodb+srv://')) {
    const afterScheme = uri.slice('mongodb+srv://'.length);
    if (!afterScheme.includes('@')) {
      throw new Error(
        'mongodb+srv URI must use user:password@cluster... — if your password contains @ or :, URL-encode it (e.g. @ → %40)'
      );
    }
    const hostAndQuery = afterScheme.split('@').pop() || '';
    const host = hostAndQuery.split('/')[0].split('?')[0];
    if (!host.includes('.')) {
      throw new Error(
        'Could not read cluster hostname from MONGO_URI (check password encoding and that the string is on one line in .env)'
      );
    }
  }
}

/**
 * @param {string} mongoUri
 */
async function connectMongoWithRetries(mongoUri) {
  const maxAttempts = Number(process.env.MONGO_CONNECT_RETRIES) || 10;
  const delayMs = Number(process.env.MONGO_CONNECT_RETRY_DELAY_MS) || 4000;

  assertMongoUriLooksValid(mongoUri);

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      await mongoose.connect(mongoUri, mongooseConnectOptions(mongoUri));
      try {
        await mongoose.connection.db.admin().command({ ping: 1 });
      } catch (pingErr) {
        console.warn('Mongo ping skipped:', pingErr.message);
      }
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`MongoDB connection attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

async function bootstrap() {
  await attachRedisSessionIfConfigured(app);

  app.use('/', uiRoutes);
  app.use('/products', productRoutes);

  const mongoUri =
    String(process.env.MONGO_URI || '')
      .trim()
      .replace(/^['"]|['"]$/g, '') || 'mongodb://localhost:27017/products_db';

  let usingMongo = false;
  try {
    await connectMongoWithRetries(mongoUri);
    usingMongo = true;
    console.log('Connected to MongoDB — using mongodb as data source.');
  } catch (err) {
    usingMongo = false;
    console.error('MongoDB connection failed:', err.message);
    if (!allowInMemoryFallback) {
      console.error(
        'ALLOW_IN_MEMORY_FALLBACK is false — exiting (fix MONGO_URI / DocumentDB TLS / network).'
      );
      process.exit(1);
    }
    console.error('Falling back to in-memory database.');
    if (String(err.message).includes('hostname') || String(err.message).includes('tld')) {
      console.error(
        'Hint: in mongodb+srv://USER:PASS@cluster... the PASS must not break on @. Encode @ as %40. Copy the full URI from Atlas → Connect → Drivers.'
      );
    }
  }

  await dataSource.init(usingMongo);

  app.listen(PORT, () => {
    appReady = true;
    console.log(`Server listening on port http://localhost:${PORT} — hostname: ${os.hostname()}`);
    console.log(`Data source in use: ${dataSource.isMongo ? 'mongodb' : 'in-memory'}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

module.exports = app;
