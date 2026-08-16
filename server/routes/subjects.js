const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Public GET /api/subjects
// Optionally filter by curriculumId query parameter
router.get('/', async (req, res) => {
  try {
    const { curriculumId } = req.query;

    let query = `
      SELECT id, name, icon, color, description
      FROM subjects
    `;
    const params = [];

    if (curriculumId) {
      const parsedId = parseInt(curriculumId, 10);
      if (isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({ error: 'Invalid curriculumId' });
      }
      query += `
        JOIN curriculum_subjects cs ON cs.subject_id = subjects.id
        WHERE cs.curriculum_id = $1
        ORDER BY subjects.name
      `;
      params.push(parsedId);
    } else {
      query += ' ORDER BY name';
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Subjects error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;