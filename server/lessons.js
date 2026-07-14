const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

router.get('/', auth, async (req, res) => {
  const { subject, grade, topic } = req.query;
  let query = 'SELECT * FROM lessons WHERE 1=1';
  const params = [];
  if (subject) { params.push(subject); query += ` AND subject_id = $${params.length}`; }
  if (grade) { params.push(grade); query += ` AND grade = $${params.length}`; }
  if (topic) { params.push(`%${topic}%`); query += ` AND topic ILIKE $${params.length}`; }
  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.get('/:id', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM lessons WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
  res.json(result.rows[0]);
});

router.post('/', auth, admin, async (req, res) => {
  const { subject_id, grade, term, topic, content, summary, examples, practice_questions } = req.body;
  const result = await pool.query(
    `INSERT INTO lessons (subject_id, grade, term, topic, content, summary, examples, practice_questions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [subject_id, grade, term, topic, content, summary, examples, practice_questions]
  );
  res.status(201).json(result.rows[0]);
});

module.exports = router;