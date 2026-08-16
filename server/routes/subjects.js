const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Public GET /api/subjects
// If curriculumId is provided and valid, return mapped subjects.
// If mapping is empty, fallback to all subjects.
// If database query fails, return 500.
router.get('/', async (req, res) => {
  try {
    const { curriculumId } = req.query;

    if (curriculumId) {
      const parsedId = parseInt(curriculumId, 10);
      if (isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({ error: 'Invalid curriculumId' });
      }

      // Query for mapped subjects
      const result = await pool.query(`
        SELECT s.id, s.name, s.icon, s.color, s.description
        FROM subjects s
        JOIN curriculum_subjects cs ON cs.subject_id = s.id
        WHERE cs.curriculum_id = $1
        ORDER BY s.name
      `, [parsedId]);

      if (result.rows.length > 0) {
        return res.json(result.rows);
      }

      // Mapping is empty – fallback to all subjects
      console.warn(`⚠️ No subjects mapped for curriculumId ${parsedId}, returning all subjects as fallback.`);
      const allResult = await pool.query('SELECT id, name, icon, color, description FROM subjects ORDER BY name');
      return res.json(allResult.rows);
    }

    // No curriculumId – return all subjects
    const result = await pool.query('SELECT id, name, icon, color, description FROM subjects ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Subjects API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;