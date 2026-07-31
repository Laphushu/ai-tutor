const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/auth');

// ===== GET /api/subjects (already have user_subjects) – we can just return subjects from user_subjects
// Actually we already get subjects from /me or /dashboard, but this endpoint can be used to list all available subjects
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, icon, color, description FROM subjects ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;