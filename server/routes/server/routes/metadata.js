const express = require('express');
const router = express.Router();
const { pool } = require('../db'); // Adjust this path if your db connection file is named differently

router.get('/countries', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, code FROM countries ORDER BY name ASC');
    res.json({ success: true, countries: result.rows });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

router.get('/provinces', async (req, res) => {
  const { countryId } = req.query;
  try {
    const result = await pool.query('SELECT id, name FROM provinces WHERE country_id = $1 ORDER BY name ASC', [countryId]);
    res.json({ success: true, provinces: result.rows });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

router.get('/curricula', async (req, res) => {
  const { countryId } = req.query;
  try {
    const result = await pool.query('SELECT id, name FROM curricula WHERE country_id = $1 ORDER BY name ASC', [countryId]);
    res.json({ success: true, curricula: result.rows });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

router.get('/education-levels', async (req, res) => {
  const { curriculumId } = req.query;
  try {
    const result = await pool.query('SELECT id, name FROM education_levels WHERE curriculum_id = $1 ORDER BY id ASC', [curriculumId]);
    res.json({ success: true, educationLevels: result.rows });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

router.get('/grades', async (req, res) => {
  const { educationLevelId } = req.query;
  try {
    const result = await pool.query('SELECT id, name FROM grades WHERE education_level_id = $1 ORDER BY rank_order ASC', [educationLevelId]);
    res.json({ success: true, grades: result.rows });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

router.get('/subjects', async (req, res) => {
  const { curriculumId, gradeId } = req.query;
  try {
    const result = await pool.query(
      'SELECT id, name FROM subjects WHERE curriculum_id = $1 AND grade_id = $2 ORDER BY name ASC', 
      [curriculumId, gradeId]
    );
    res.json({ success: true, subjects: result.rows });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

module.exports = router;