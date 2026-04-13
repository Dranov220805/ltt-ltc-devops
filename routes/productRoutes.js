const express = require('express');
const router = express.Router();
const controller = require('../controllers/productController');
const validators = require('../validators/productValidator');
const { validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');

// multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', upload.single('imageFile'), validators.create, handleValidation, controller.create);
router.put('/:id', upload.single('imageFile'), validators.put, handleValidation, controller.put);
router.patch('/:id', upload.single('imageFile'), validators.patch, handleValidation, controller.patch);
router.delete('/:id', controller.remove);

module.exports = router;
