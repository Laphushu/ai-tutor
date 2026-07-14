const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// Get all users (admin only)
router.get('/users', auth, admin, async (req, res) => {
  const result = await pool.query('SELECT id, first_name, last_name, email, role, is_admin FROM users');
  res.json(result.rows);
});

// Get platform stats
router.get('/stats', auth, admin, async (req, res) => {
  const users = await pool.query('SELECT COUNT(*) FROM users');
  const papers = await pool.query('SELECT COUNT(*) FROM past_papers');
  const lessons = await pool.query('SELECT COUNT(*) FROM lessons');
  const quizzes = await pool.query('SELECT COUNT(*) FROM quizzes');
  res.json({
    users: parseInt(users.rows[0].count),
    pastPapers: parseInt(papers.rows[0].count),
    lessons: parseInt(lessons.rows[0].count),
    quizzes: parseInt(quizzes.rows[0].count)
  });
});

module.exports = router;