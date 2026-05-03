const express = require('express');
const os = require('os');
const router = express.Router();
const dataSource = require('../services/dataSource');
const runtimeInfo = require('../services/runtimeInfo');

router.get('/', async (req, res, next) => {
  try {
    const products = await dataSource.getAll();
    const runtimeSnapshot = runtimeInfo.getSnapshot({ appUsesMongo: dataSource.isMongo });
    res.render('index', {
      products,
      hostname: os.hostname(),
      source: dataSource.isMongo ? 'mongodb' : 'in-memory',
      runtimeSnapshot
    });
  } catch (err) { next(err); }
});

module.exports = router;
