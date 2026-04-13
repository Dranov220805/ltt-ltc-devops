const { v4: uuidv4 } = require('uuid');
const ProductModel = require('../models/product');
const fs = require('fs').promises;
const path = require('path');

let inMemory = [];
let isMongo = false;

function createAppleProducts() {
  // Realistic Apple product list with example prices and short descriptions
  const products = [
    {
      name: 'iPhone 14 Pro Max',
      price: 1099,
      color: 'space-black',
      description: '6.7‑inch Super Retina XDR display, A16 Bionic chip, pro camera system.',
      imageUrl: ''
    },
    {
      name: 'iPhone SE (3rd generation)',
      price: 429,
      color: 'black',
      description: 'Compact design with A15 Bionic, great value for everyday use.',
      imageUrl: ''
    },
    {
      name: 'MacBook Pro 14-inch (M2 Pro)',
      price: 1999,
      color: 'silver',
      description: 'Powerful M2 Pro chip, Liquid Retina XDR display, up to 18‑hour battery life.'
    },
    {
      name: 'MacBook Air 13-inch (M2)',
      price: 1199,
      color: 'midnight',
      description: 'Thin and light with M2 chip, silent fanless design and great battery life.'
    },
    {
      name: 'iPad Pro 11-inch (M4)',
      price: 799,
      color: 'silver',
      description: 'M4 chip, Liquid Retina display with ProMotion, powerful for creative work.'
    },
    {
      name: 'Apple Watch Series 9',
      price: 399,
      color: 'starlight',
      description: 'Faster S9 chip, more accurate sensors, and brighter display.'
    },
    {
      name: 'AirPods Pro (2nd generation)',
      price: 249,
      color: 'white',
      description: 'Active Noise Cancellation, improved audio quality and longer battery.'
    },
    {
      name: 'HomePod (2nd generation)',
      price: 299,
      color: 'white',
      description: 'High-fidelity audio with computational audio and Siri smart home control.'
    },
    {
      name: 'iPhone 13',
      price: 699,
      color: 'blue',
      description: 'A great all-rounder with excellent battery life and dual-camera system.'
    },
    {
      name: 'iPad (10th generation)',
      price: 449,
      color: 'pink',
      description: 'Updated design, larger display, and capable for school and home use.',
      imageUrl: ''
    }
  ];

  // attach UUID ids for in-memory use
  return products.map(p => ({ id: uuidv4(), ...p }));
}

async function init(useMongo) {
  isMongo = !!useMongo;
  // seed in-memory array always
  inMemory = createAppleProducts();

  if (isMongo) {
    try {
      const count = await ProductModel.countDocuments();
      if (count === 0) {
        // seed mongodb with items mapped to schema (exclude in-memory id)
        const docs = inMemory.map(({ name, price, color, description, imageUrl }) => ({ name, price, color, description, imageUrl }));
        await ProductModel.insertMany(docs);
      }
    } catch (err) {
      // if anything goes wrong, fall back to in-memory
      isMongo = false;
    }
  }
}

// Helpers to adapt mongo documents to expected output (include id)
function toDTO(doc) {
  if (!doc) return null;
  if (doc.id) return doc; // in-memory
  return { id: doc._id.toString(), name: doc.name, price: doc.price, color: doc.color, description: doc.description || null, imageUrl: doc.imageUrl || '' };
}

async function getAll() {
  if (isMongo) {
    const docs = await ProductModel.find().lean();
    return docs.map(toDTO);
  }
  return inMemory.slice();
}

async function getById(id) {
  if (isMongo) {
    const doc = await ProductModel.findById(id).lean();
    return toDTO(doc);
  }
  return inMemory.find(p => p.id === id) || null;
}

async function create(payload) {
  if (isMongo) {
    const doc = await ProductModel.create(payload);
    return toDTO(doc.toObject());
  }
  const item = { id: uuidv4(), ...payload };
  inMemory.push(item);
  return item;
}

async function replace(id, payload) {
  if (isMongo) {
    const doc = await ProductModel.findByIdAndUpdate(id, payload, { new: true, runValidators: true }).lean();
    return toDTO(doc);
  }
  const idx = inMemory.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const prev = inMemory[idx];
  // if payload contains imageUrl and prev had a local upload, remove old file
  if (payload.imageUrl && prev && prev.imageUrl && prev.imageUrl.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', 'public', prev.imageUrl.substring(1));
    try { await fs.unlink(filePath); } catch (e) { /* ignore */ }
  }
  const item = { id, ...payload };
  inMemory[idx] = item;
  return item;
}

async function patch(id, payload) {
  if (isMongo) {
    // if updating image, delete previous uploaded file
    if (payload.imageUrl) {
      const prevDoc = await ProductModel.findById(id).lean();
      if (prevDoc && prevDoc.imageUrl && prevDoc.imageUrl.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', 'public', prevDoc.imageUrl.substring(1));
        try { await fs.unlink(filePath); } catch (e) { /* ignore */ }
      }
    }
    const doc = await ProductModel.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true }).lean();
    return toDTO(doc);
  }
  const item = inMemory.find(p => p.id === id);
  if (!item) return null;
  // handle image replacement: delete old file if needed
  if (payload.imageUrl && item.imageUrl && item.imageUrl.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', 'public', item.imageUrl.substring(1));
    try { await fs.unlink(filePath); } catch (e) { /* ignore */ }
  }
  Object.assign(item, payload);
  return item;
}

async function remove(id) {
  if (isMongo) {
    const doc = await ProductModel.findByIdAndDelete(id).lean();
    if (doc && doc.imageUrl && doc.imageUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', 'public', doc.imageUrl.substring(1));
      try { await fs.unlink(filePath); } catch (e) { /* ignore */ }
    }
    return toDTO(doc);
  }
  const idx = inMemory.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const [deleted] = inMemory.splice(idx, 1);
  if (deleted && deleted.imageUrl && deleted.imageUrl.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', 'public', deleted.imageUrl.substring(1));
    try { await fs.unlink(filePath); } catch (e) { /* ignore */ }
  }
  return deleted;
}

module.exports = {
  init,
  getAll,
  getById,
  create,
  replace,
  patch,
  remove,
  get isMongo() { return isMongo; }
};
