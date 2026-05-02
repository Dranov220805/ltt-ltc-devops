require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const os = require('os');
const productRoutes = require('./routes/productRoutes');
const dataSource = require('./services/dataSource');
const uiRoutes = require('./routes/uiRoutes');
const path = require('path');
const fs = require('fs'); 

const app = express();
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

// view engine and static
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', uiRoutes);
app.use('/products', productRoutes);

const PORT = process.env.PORT || 3000;

/**
 * @param {string} uri
 * @returns {import('mongoose').ConnectOptions}
 */
function mongooseConnectOptions(uri) {
  const serverSelectionTimeoutMS =
    Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 30000;
  if (uri.startsWith('mongodb+srv://')) {
    return {
      serverSelectionTimeoutMS,
      // Atlas / Stable API (matches MongoDB sample driver code)
      serverApi: { version: '1', strict: true, deprecationErrors: true }
    };
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

async function start() {
  // Đảm bảo thư mục uploads tồn tại
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`Created uploads directory at ${uploadsDir}`);
  }

  // Use TRIM: empty/whitespace MONGO_URI should fall back to local default.
  // .env: one line, no surrounding quotes required; password special chars must be percent-encoded in the URI.
  const mongoUri = String(process.env.MONGO_URI || '')
    .trim()
    .replace(/^['"]|['"]$/g, '') || 'mongodb://localhost:27017/products_db';
  let usingMongo = false;
  try {
    assertMongoUriLooksValid(mongoUri);
    await mongoose.connect(mongoUri, mongooseConnectOptions(mongoUri));
    // Optional: verify server responds (like Atlas sample `ping`)
    if (mongoUri.startsWith('mongodb+srv://')) {
      await mongoose.connection.db.admin().command({ ping: 1 });
    }
    usingMongo = true;
    console.log('Connected to MongoDB — using mongodb as data source.');
  } catch (err) {
    usingMongo = false;
    console.error(
      'MongoDB connection failed — falling back to in-memory database:',
      err.message
    );
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

start();

module.exports = app;
