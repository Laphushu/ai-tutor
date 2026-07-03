// server/routes/progress.js
const express = require('express');
const { pool } = require('../db');
const router = express.Router();

router.post('/', async (req, res) => {
  const { userId, subjectId, topicName } = req.body;
  if (!userId || !subjectId || !topicName) return res.status(400).json({ error: 'Missing fields' });
  try {
    await pool.query(
      `INSERT INTO progress (user_id, subject_id, topic_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, subjectId, topicName]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const result = await pool.query(`
      SELECT s.name AS subject_name, p.topic_name, p.completed_at
      FROM progress p
      JOIN subjects s ON p.subject_id = s.id
      WHERE p.user_id = $1
    `, [userId]);
    const progress = {};
    result.rows.forEach(row => {
      if (!progress[row.subject_name]) progress[row.subject_name] = [];
      progress[row.subject_name].push(row.topic_name);
    });
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;