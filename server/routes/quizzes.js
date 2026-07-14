const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

router.get('/', auth, async (req, res) => {
  const { subject, grade, topic } = req.query;
  let query = 'SELECT * FROM quizzes WHERE 1=1';
  const params = [];
  if (subject) { params.push(subject); query += ` AND subject_id = $${params.length}`; }
  if (grade) { params.push(grade); query += ` AND grade = $${params.length}`; }
  if (topic) { params.push(`%${topic}%`); query += ` AND topic ILIKE $${params.length}`; }
  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.get('/:id', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM quizzes WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Quiz not found' });
  res.json(result.rows[0]);
});

router.post('/submit', auth, async (req, res) => {
  const { quizId, answers } = req.body;
  const quizResult = await pool.query('SELECT questions FROM quizzes WHERE id = $1', [quizId]);
  if (quizResult.rows.length === 0) return res.status(404).json({ error: 'Quiz not found' });
  const questions = quizResult.rows[0].questions;
  let score = 0;
  const results = questions.map((q, i) => {
    const userAnswer = answers[i] || '';
    const correct = userAnswer === q.correct_answer;
    if (correct) score++;
    return { question: q.question, userAnswer, correct, explanation: q.explanation };
  });
  res.json({ score, total: questions.length, results });
});

router.post('/', auth, admin, async (req, res) => {
  const { subject_id, grade, topic, questions, difficulty } = req.body;
  const result = await pool.query(
    `INSERT INTO quizzes (subject_id, grade, topic, questions, difficulty)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [subject_id, grade, topic, questions, difficulty]
  );
  res.status(201).json(result.rows[0]);
});

module.exports = router;