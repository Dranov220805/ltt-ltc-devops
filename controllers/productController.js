const os = require('os');
const dataSource = require('../services/dataSource');

function meta() {
  return { hostname: os.hostname(), source: dataSource.isMongo ? 'mongodb' : 'in-memory' };
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
    if (file) payload.imageUrl = `/uploads/${file.filename}`;
    const item = await dataSource.create(payload);
    res.status(201).json({ data: item, ...meta() });
  } catch (err) { next(err); }
}

async function put(req, res, next) {
  try {
    const file = req.file;
    const payload = (({ name, price, color, description }) => ({ name, price, color, description }))(req.body);
    if (file) payload.imageUrl = `/uploads/${file.filename}`;
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
    if (file) payload.imageUrl = `/uploads/${file.filename}`;
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
