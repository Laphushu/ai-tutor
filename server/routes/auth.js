const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// SIGNUP
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, countryId, province, educationLevelId, grade, curriculumId, subjects, role } = req.body;
  if (!firstName || !lastName || !email || !password || !countryId || !educationLevelId || !grade || !curriculumId || !subjects) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, country_id, province, education_level_id, grade, curriculum_id, subjects, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, first_name, last_name, email, role`,
      [firstName, lastName, email, passwordHash, countryId, province, educationLevelId, grade, curriculumId, JSON.stringify(subjects), role || 'learner']
    );
    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, password_hash, role, grade, subjects, country_id, province, education_level_id, curriculum_id,
              (SELECT name FROM countries WHERE id = users.country_id) AS country_name,
              (SELECT name FROM curricula WHERE id = users.curriculum_id) AS curriculum_name,
              (SELECT name FROM education_levels WHERE id = users.education_level_id) AS education_level_name,
              grade AS grade_name
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    delete user.password_hash;

    if (typeof user.subjects === 'string') {
      try { user.subjects = JSON.parse(user.subjects); } catch (e) {}
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role || 'learner' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;