const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/lookup/countries
router.get('/countries', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, code FROM countries ORDER BY name');
    res.json(result.rows); // direct array
  } catch (err) {
    console.error('Countries lookup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/lookup/provinces?countryId=ID
router.get('/provinces', async (req, res) => {
  const { countryId } = req.query;
  if (!countryId) {
    return res.status(400).json({ error: 'countryId query parameter is required.' });
  }
  const parsedId = parseInt(countryId, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    return res.status(400).json({ error: 'countryId must be a positive integer.' });
  }
  try {
    const result = await pool.query(
      'SELECT id, country_id, name FROM provinces WHERE country_id = $1 ORDER BY name',
      [parsedId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Provinces lookup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/lookup/curricula
router.get('/curricula', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, country_id, name FROM curricula ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Curricula lookup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/lookup/education-levels
router.get('/education-levels', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, sort_order FROM education_levels ORDER BY sort_order, name');
    res.json(result.rows);
  } catch (err) {
    console.error('Education levels lookup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;