// server/routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const router = express.Router();
const SALT_ROUNDS = 10;

// Signup
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, countryId, provinceId, educationLevelId, curriculumId, gradeId, subjects, role } = req.body;
  if (!firstName || !lastName || !email || !password || !countryId || !educationLevelId || !curriculumId || !gradeId) {
    return res.status(400).json({ error: 'All required fields must be filled' });
  }
  if (!subjects || subjects.length === 0) {
    return res.status(400).json({ error: 'Please select at least one subject' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const subjectsJson = JSON.stringify(subjects);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, country_id, province_id, education_level_id, curriculum_id, grade_id, role, subjects)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [email, hash, firstName, lastName, countryId, provinceId || null, educationLevelId, curriculumId, gradeId, role || 'learner', subjectsJson]
    );
    const userId = result.rows[0].id;
    await pool.query(
      `INSERT INTO subscriptions (user_id, status, end_date) VALUES ($1, 'trial', NOW() + INTERVAL '3 days')`,
      [userId]
    );
    res.json({ success: true, userId });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name,
             u.country_id, u.province_id, u.education_level_id, u.curriculum_id, u.grade_id,
             u.role, u.subjects,
             c.name AS country_name, p.name AS province_name,
             el.name AS education_level_name,
             cur.name AS curriculum_name,
             g.name AS grade_name
      FROM users u
      LEFT JOIN countries c ON u.country_id = c.id
      LEFT JOIN provinces p ON u.province_id = p.id
      LEFT JOIN education_levels el ON u.education_level_id = el.id
      LEFT JOIN curricula cur ON u.curriculum_id = cur.id
      LEFT JOIN grades g ON u.grade_id = g.id
      WHERE u.email = $1
    `, [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    // Get subscription
    const subResult = await pool.query('SELECT status, end_date FROM subscriptions WHERE user_id = $1', [user.id]);
    let sub = subResult.rows[0] || { status: 'trial', end_date: new Date(Date.now() + 3*24*60*60*1000) };
    const now = new Date();
    let status = sub.status, daysRemaining = 0;
    if (sub.status === 'active' && now < sub.end_date) { status = 'active'; daysRemaining = Math.ceil((sub.end_date - now)/(1000*60*60*24)); }
    else if (sub.status === 'trial' && now < sub.end_date) { status = 'trial'; daysRemaining = Math.ceil((sub.end_date - now)/(1000*60*60*24)); }
    else { status = 'expired'; daysRemaining = 0; }
    const userData = {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      countryId: user.country_id,
      countryName: user.country_name,
      provinceId: user.province_id,
      provinceName: user.province_name,
      educationLevelId: user.education_level_id,
      educationLevelName: user.education_level_name,
      curriculumId: user.curriculum_id,
      curriculumName: user.curriculum_name,
      gradeId: user.grade_id,
      gradeName: user.grade_name,
      subjects: user.subjects || [],
      role: user.role,
      subscription: { status, daysRemaining }
    };
    res.json({ success: true, user: userData, token: 'mock-token' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Subscription status
router.get('/subscription/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const result = await pool.query('SELECT status, end_date FROM subscriptions WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) return res.json({ status: 'trial', daysRemaining: 3 });
    const sub = result.rows[0];
    const now = new Date();
    let status = 'expired', days = 0;
    if (sub.status === 'active' && now < sub.end_date) { status = 'active'; days = Math.ceil((sub.end_date - now)/(1000*60*60*24)); }
    else if (sub.status === 'trial' && now < sub.end_date) { status = 'trial'; days = Math.ceil((sub.end_date - now)/(1000*60*60*24)); }
    res.json({ status, daysRemaining: Math.max(0, days) });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;