const os = require('os');
const dataSource = require('../services/dataSource');
const s3 = require('../services/s3');
const runtimeInfo = require('../services/runtimeInfo');

function meta() {
  return {
    hostname: os.hostname(),
    source: dataSource.isMongo ? 'mongodb' : 'in-memory',
    ...runtimeInfo.getMetaAugment()
  };
}

function safeImageFilename(originalname) {
  return Date.now() + '-' + String(originalname || 'image').replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

/**
 * @param {import('multer').File} [file]
 * @returns {Promise<string|undefined>} imageUrl to store
 */
async function resolveImageUrlFromFile(file) {
  if (!file) return undefined;
  if (s3.s3Enabled()) {
    const filename = safeImageFilename(file.originalname);
    await s3.putUpload(filename, file.buffer, file.mimetype);
    return `/uploads/${filename}`;
  }
  if (file.buffer && process.env.FORCE_MEMORY_UPLOADS === 'true') {
    console.warn('Skipping image persist: disk uploads disabled (read-only FS) and S3_BUCKET unset.');
    return undefined;
  }
  return `/uploads/${file.filename}`;
}

async function list(req, res, next) {
  try {
    const items = await dataSource.getAll();
    res.json({ data: items, ...meta() });
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    const item = await dataSource.getById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found', ...meta() });
    res.json({ data: item, ...meta() });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const file = req.file;
    const payload = (({ name, price, color, description }) => ({ name, price, color, description }))(req.body);
    const imageUrl = await resolveImageUrlFromFile(file);
    if (imageUrl) payload.imageUrl = imageUrl;
    const item = await dataSource.create(payload);
    res.status(201).json({ data: item, ...meta() });
  } catch (err) { next(err); }
}

async function put(req, res, next) {
  try {
    const file = req.file;
    const payload = (({ name, price, color, description }) => ({ name, price, color, description }))(req.body);
    const imageUrl = await resolveImageUrlFromFile(file);
    if (imageUrl) payload.imageUrl = imageUrl;
    const item = await dataSource.replace(req.params.id, payload);
    if (!item) return res.status(404).json({ message: 'Not found', ...meta() });
    res.json({ data: item, ...meta() });
  } catch (err) { next(err); }
}

async function patch(req, res, next) {
  try {
    const file = req.file;
    const payload = {};
    ['name','price','color','description'].forEach(k => { if (k in req.body) payload[k] = req.body[k]; });
    const imageUrl = await resolveImageUrlFromFile(file);
    if (imageUrl) payload.imageUrl = imageUrl;
    const item = await dataSource.patch(req.params.id, payload);
    if (!item) return res.status(404).json({ message: 'Not found', ...meta() });
    res.json({ data: item, ...meta() });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const item = await dataSource.remove(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found', ...meta() });
    res.json({ data: item, ...meta() });
  } catch (err) { next(err); }
}

module.exports = { list, getOne, create, put, patch, remove };
