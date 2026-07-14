const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const userId = req.userId;
  const result = await pool.query(
    `SELECT * FROM student_progress WHERE user_id = $1`,
    [userId]
  );
  if (result.rows.length === 0) {
    return res.json({
      lessons_completed: 0,
      quiz_scores: {},
      study_minutes: 0,
      strengths: [],
      weaknesses: []
    });
  }
  res.json(result.rows[0]);
});

router.post('/update', auth, async (req, res) => {
  const { subject_id, lessons_completed, quiz_scores, study_minutes, strengths, weaknesses } = req.body;
  await pool.query(
    `INSERT INTO student_progress (user_id, subject_id, lessons_completed, quiz_scores, study_minutes, strengths, weaknesses)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       subject_id = EXCLUDED.subject_id,
       lessons_completed = EXCLUDED.lessons_completed,
       quiz_scores = EXCLUDED.quiz_scores,
       study_minutes = EXCLUDED.study_minutes,
       strengths = EXCLUDED.strengths,
       weaknesses = EXCLUDED.weaknesses,
       updated_at = NOW()`,
    [userId, subject_id, lessons_completed, quiz_scores, study_minutes, strengths, weaknesses]
  );
  res.json({ success: true });
});

module.exports = router;