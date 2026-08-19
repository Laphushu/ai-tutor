const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/auth');

// GET /api/topics
// Authenticated, requires subject_id query param.
// Uses the authenticated user's grade and curriculum_id to filter topics.
// If no topics are found for the user's curriculum, fallback to CAPS topics.
router.get('/', authenticateToken, async (req, res) => {
  const { subject_id } = req.query;
  if (!subject_id) {
    return res.status(400).json({ error: 'subject_id is required' });
  }

  const userId = req.user.userId;

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

    // 3. Fetch topics for the user's curriculum
    let query = `
      SELECT id, title, description, order_number
      FROM topics
      WHERE subject_id = $1
        AND curriculum_id = $2
        AND grade = $3
      ORDER BY order_number, id
    `;
    let params = [subject_id, curriculum_id, grade];
    let result = await pool.query(query, params);

    // 4. If no topics found and the user's curriculum is NOT CAPS, fallback to CAPS
    if (result.rows.length === 0 && curriculum_id) {
      // Get CAPS curriculum ID (South Africa)
      const capsRes = await pool.query(
        `SELECT id FROM curricula
         WHERE name = 'CAPS'
           AND country_id = (SELECT id FROM countries WHERE code = 'ZA')`
      );
      if (capsRes.rows.length > 0) {
        const capsId = capsRes.rows[0].id;
        // Only fallback if user's curriculum is different from CAPS
        if (capsId !== curriculum_id) {
          // Also check if the subject is available for CAPS
          const capsSubjectCheck = await pool.query(
            'SELECT 1 FROM curriculum_subjects WHERE curriculum_id = $1 AND subject_id = $2',
            [capsId, subject_id]
          );
          if (capsSubjectCheck.rows.length > 0) {
            // Fetch topics for CAPS
            const fallbackQuery = `
              SELECT id, title, description, order_number
              FROM topics
              WHERE subject_id = $1
                AND curriculum_id = $2
                AND grade = $3
              ORDER BY order_number, id
            `;
            const fallbackResult = await pool.query(fallbackQuery, [subject_id, capsId, grade]);
            result = fallbackResult;
          }
        }
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Topics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;