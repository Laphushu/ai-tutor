const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/auth');

// GET /api/topics
// Authenticated, requires subject_id query param.
// Uses the authenticated user's grade and curriculum_id to filter topics.
// Also ensures the subject is available for that curriculum.
router.get('/', authenticateToken, async (req, res) => {
  const { subject_id } = req.query;
  if (!subject_id) {
    return res.status(400).json({ error: 'subject_id is required' });
  }

  const userId = req.user.userId; // confirmed from auth middleware

  try {
    // 1. Fetch user's grade and curriculum_id
    const userRes = await pool.query(
      'SELECT grade, curriculum_id FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { grade, curriculum_id } = userRes.rows[0];

    // 2. Verify that the subject belongs to the user's curriculum
    const subjectCheck = await pool.query(
      'SELECT 1 FROM curriculum_subjects WHERE curriculum_id = $1 AND subject_id = $2',
      [curriculum_id, subject_id]
    );
    if (subjectCheck.rows.length === 0) {
      return res.status(403).json({
        error: 'This subject is not available for your curriculum.'
      });
    }

    // 3. Fetch topics that exactly match the user's grade, curriculum, and subject
    const query = `
      SELECT id, title, description, order_number
      FROM topics
      WHERE subject_id = $1
        AND curriculum_id = $2
        AND grade = $3
      ORDER BY order_number, id
    `;
    const result = await pool.query(query, [subject_id, curriculum_id, grade]);
    res.json(result.rows);
  } catch (err) {
    console.error('Topics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;