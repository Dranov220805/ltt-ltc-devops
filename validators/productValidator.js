const { body } = require('express-validator');

const create = [
  body('name').isString().isLength({ min: 1 }),
  body('price').isNumeric(),
  body('color').isString().isLength({ min: 1 }),
  body('description').optional().isString().isLength({ max: 5000 }),
  body('imageUrl').optional().isString().isLength({ max: 500000 })
];

const put = [
  body('name').exists().isString().isLength({ min: 1 }),
  body('price').exists().isNumeric(),
  body('color').exists().isString().isLength({ min: 1 }),
  body('description').optional().isString().isLength({ max: 5000 }),
  body('imageUrl').optional().isString().isLength({ max: 500000 })
];

const patch = [
  body('name').optional().isString().isLength({ min: 1 }),
  body('price').optional().isNumeric(),
  body('color').optional().isString().isLength({ min: 1 }),
  body('description').optional().isString().isLength({ max: 5000 }),
  body('imageUrl').optional().isString().isLength({ max: 500000 })
];

module.exports = { create, put, patch };
