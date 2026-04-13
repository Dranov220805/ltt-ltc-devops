const express = require('express');
const router = express.Router();
const dataSource = require('../services/dataSource');

router.get('/', async (req, res, next) => {
  try {
    const products = await dataSource.getAll();
    res.render('index', { products, hostname: require('os').hostname(), source: dataSource.isMongo ? 'mongodb' : 'in-memory' });
  } catch (err) { next(err); }
});

module.exports = router;
