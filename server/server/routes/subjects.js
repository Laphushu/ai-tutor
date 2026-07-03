// server/routes/subjects.js
const express = require('express');
const { pool } = require('../db');
const router = express.Router();

router.get('/countries', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM countries ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/provinces/:countryId', async (req, res) => {
  const countryId = parseInt(req.params.countryId);
  try {
    const result = await pool.query('SELECT * FROM provinces WHERE country_id = $1 ORDER BY name', [countryId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/education-levels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM education_levels ORDER BY sort_order');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/grades/:levelId', async (req, res) => {
  const levelId = parseInt(req.params.levelId);
  try {
    const result = await pool.query('SELECT * FROM grades WHERE education_level_id = $1 ORDER BY sort_order', [levelId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/curricula/:countryId', async (req, res) => {
  const countryId = parseInt(req.params.countryId);
  try {
    const result = await pool.query('SELECT * FROM curricula WHERE country_id = $1 ORDER BY name', [countryId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/subjects/:curriculumId/:gradeId', async (req, res) => {
  const curriculumId = parseInt(req.params.curriculumId);
  const gradeId = parseInt(req.params.gradeId);
  try {
    const result = await pool.query(
      'SELECT name FROM subjects WHERE curriculum_id = $1 AND grade_id = $2 ORDER BY name',
      [curriculumId, gradeId]
    );
    res.json(result.rows.map(r => r.name));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;