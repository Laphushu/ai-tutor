// server/routes/admin.js
const express = require('express');
const { pool } = require('../db');
const router = express.Router();

async function requireAdmin(req, res, next) {
  const userId = req.body.userId || req.query.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });
    if (result.rows[0].role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
}

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at, u.subjects,
             s.status, s.end_date
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const subscriptions = await pool.query('SELECT COUNT(*) FROM subscriptions WHERE status = $1', ['active']);
    const trials = await pool.query('SELECT COUNT(*) FROM subscriptions WHERE status = $1', ['trial']);
    const progress = await pool.query('SELECT COUNT(*) FROM progress');
    res.json({
      totalUsers: parseInt(users.rows[0].count),
      activeSubscriptions: parseInt(subscriptions.rows[0].count),
      trialUsers: parseInt(trials.rows[0].count),
      totalProgress: parseInt(progress.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/subscriptions', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name,
             s.status, s.start_date, s.end_date
      FROM users u
      JOIN subscriptions s ON u.id = s.user_id
      ORDER BY s.end_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;