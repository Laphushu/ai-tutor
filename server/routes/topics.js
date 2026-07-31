const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/auth');

// ===== GET /api/topics?subject_id=X&grade=Y =====
router.get('/', authenticateToken, async (req, res) => {
  const { subject_id, grade, curriculum_id } = req.query;
  if (!subject_id) {
    return res.status(400).json({ error: 'subject_id is required' });
  }
  try {
    let query = 'SELECT id, title, description, order_number FROM topics WHERE subject_id = $1';
    const params = [subject_id];
    if (grade) {
      query += ' AND grade = $2';
      params.push(grade);
    }
    if (curriculum_id) {
      query += ' AND (curriculum_id = $3 OR curriculum_id IS NULL)';
      params.push(curriculum_id);
    }
    query += ' ORDER BY order_number, title';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Topics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;