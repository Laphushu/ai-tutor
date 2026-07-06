const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const router = express.Router();
const SALT_ROUNDS = 10;

async function getProvinceId(countryId, provinceName) {
  if (!provinceName) return null;
  const result = await pool.query(
    'SELECT id FROM provinces WHERE country_id = $1 AND name = $2',
    [countryId, provinceName]
  );
  return result.rows.length ? result.rows[0].id : null;
}

// Signup – free plan by default
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, countryId, province, educationLevelId, curriculumId, gradeId, subjects, role } = req.body;
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
    const provinceId = await getProvinceId(countryId, province);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, country_id, province_id, education_level_id, curriculum_id, grade_id, role, subjects, plan, daily_question_count, last_question_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [email, hash, firstName, lastName, countryId, provinceId, educationLevelId, curriculumId, gradeId, role || 'learner', subjectsJson, 'free', 0, null]
    );
    const userId = result.rows[0].id;
    res.json({ success: true, userId });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Login – returns plan
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name,
             u.country_id, u.province_id, u.education_level_id, u.curriculum_id, u.grade_id,
             u.role, u.subjects, u.plan,
             c.name AS country_name, p.name AS province_name,
             el.name AS education_level_name,
             cur.name AS curriculum_name,
             g.display_name AS grade_name
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

    // Check if premium subscription expired
    let plan = user.plan || 'free';
    if (plan === 'premium') {
      const subResult = await pool.query('SELECT end_date FROM subscriptions WHERE user_id = $1', [user.id]);
      if (subResult.rows.length && new Date(subResult.rows[0].end_date) < new Date()) {
        plan = 'free';
        await pool.query('UPDATE users SET plan = $1 WHERE id = $2', ['free', user.id]);
      }
    }

    const userData = {
      id: user.id,
      firstName: user.first_name || 'Student',
      lastName: user.last_name || '',
      email: user.email,
      countryId: user.country_id,
      countryName: user.country_name || 'Not set',
      provinceId: user.province_id,
      provinceName: user.province_name || null,
      educationLevelId: user.education_level_id,
      educationLevelName: user.education_level_name || 'Not set',
      curriculumId: user.curriculum_id,
      curriculumName: user.curriculum_name || 'Not set',
      gradeId: user.grade_id,
      gradeName: user.grade_name || 'Not set',
      subjects: user.subjects || [],
      role: user.role || 'learner',
      plan: plan
    };
    res.json({ success: true, user: userData, token: 'mock-token' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get subscription status and remaining questions
router.get('/subscription/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const result = await pool.query(
      'SELECT plan, daily_question_count, last_question_date FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];
    const today = new Date().toISOString().split('T')[0];
    const lastDate = user.last_question_date ? user.last_question_date.toISOString().split('T')[0] : null;
    let remaining = 10;
    if (user.plan === 'premium') {
      remaining = Infinity;
    } else {
      const count = (lastDate === today) ? (user.daily_question_count || 0) : 0;
      remaining = Math.max(0, 10 - count);
    }
    res.json({
      plan: user.plan,
      remainingQuestions: remaining,
      isPremium: user.plan === 'premium'
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;