const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const authenticateToken = require('../middleware/auth');

// ===== SIGNUP =====
router.post('/signup', async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    countryId,
    provinceId,
    educationLevelId,
    grade,
    curriculumId,
    subjects,
    role
  } = req.body;

  // Validate required fields
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'First name, last name, email, and password are required.' });
  }
  if (!countryId || !provinceId || !educationLevelId || !grade || !curriculumId) {
    return res.status(400).json({ error: 'Country, province, education level, grade, and curriculum are required.' });
  }
  if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
    return res.status(400).json({ error: 'At least one subject must be selected.' });
  }

  // Validate IDs are integers
  const parsedCountryId = parseInt(countryId, 10);
  const parsedProvinceId = parseInt(provinceId, 10);
  const parsedEducationLevelId = parseInt(educationLevelId, 10);
  const parsedCurriculumId = parseInt(curriculumId, 10);

  if (isNaN(parsedCountryId) || isNaN(parsedProvinceId) || isNaN(parsedEducationLevelId) || isNaN(parsedCurriculumId)) {
    return res.status(400).json({ error: 'Invalid ID provided for country, province, education level, or curriculum.' });
  }

  // Normalize email
  const normalizedEmail = email.trim().toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check duplicate email
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This email already has an account. Please log in.' });
    }

    // Validate province belongs to country
    const provinceCheck = await client.query(
      'SELECT id FROM provinces WHERE id = $1 AND country_id = $2',
      [parsedProvinceId, parsedCountryId]
    );
    if (provinceCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected province does not belong to the selected country.' });
    }

    // Validate curriculum belongs to country
    const curriculumCheck = await client.query(
      'SELECT id FROM curricula WHERE id = $1 AND country_id = $2',
      [parsedCurriculumId, parsedCountryId]
    );
    if (curriculumCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected curriculum does not belong to the selected country.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const userResult = await client.query(
      `INSERT INTO users
        (first_name, last_name, email, password_hash, country_id, province_id, education_level_id, grade, curriculum_id, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, first_name, last_name, email, role`,
      [
        firstName,
        lastName,
        normalizedEmail,
        passwordHash,
        parsedCountryId,
        parsedProvinceId,
        parsedEducationLevelId,
        grade,
        parsedCurriculumId,
        role || 'learner'
      ]
    );
    const user = userResult.rows[0];

    // Insert subjects
    for (const subName of subjects) {
      const subRes = await client.query('SELECT id FROM subjects WHERE name = $1', [subName]);
      if (subRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Subject "${subName}" does not exist.` });
      }
      const subjectId = subRes.rows[0].id;
      await client.query(
        'INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user.id, subjectId]
      );
    }

    // Create 3‑day free trial subscription
    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 3);

    await client.query(
      `INSERT INTO subscriptions (user_id, plan, status, start_date, expires_at)
       VALUES ($1, 'free', 'active', $2, $3)`,
      [user.id, startDate, expiryDate]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, user });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Signup error:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This email already has an account. Please log in.' });
    }
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid reference: one of the provided IDs does not exist.' });
    }
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ===== LOGIN =====
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, password_hash, role, grade,
              country_id, province_id, education_level_id, curriculum_id
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    delete user.password_hash;

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

// ===== GET /api/auth/me =====
router.get('/me', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    // Removed "plan" from SELECT – it's only in subscriptions
    const userResult = await pool.query(
      `SELECT
        id, first_name, last_name, email, role, grade,
        country_id, province_id, education_level_id, curriculum_id,
        daily_question_count, last_question_date
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    // Enrich with related data
    const countryRes = await pool.query('SELECT id, name FROM countries WHERE id = $1', [user.country_id]);
    const curriculumRes = await pool.query('SELECT id, name FROM curricula WHERE id = $1', [user.curriculum_id]);
    const levelRes = await pool.query('SELECT id, name FROM education_levels WHERE id = $1', [user.education_level_id]);

    const subjectsRes = await pool.query(
      `SELECT s.id, s.name, s.icon, s.color
       FROM subjects s
       JOIN user_subjects us ON us.subject_id = s.id
       WHERE us.user_id = $1
       ORDER BY s.name`,
      [userId]
    );

    const subRes = await pool.query(
      `SELECT plan, status, start_date, expires_at
       FROM subscriptions
       WHERE user_id = $1`,
      [userId]
    );
    const subscription = subRes.rows[0] || { plan: 'free', status: 'active', expires_at: null };

    // Daily question limit – safely handle date
    const today = new Date().toISOString().split('T')[0];
    let lastDate = null;
    if (user.last_question_date) {
      const dateObj = user.last_question_date instanceof Date
        ? user.last_question_date
        : new Date(user.last_question_date);
      if (!isNaN(dateObj.getTime())) {
        lastDate = dateObj.toISOString().split('T')[0];
      }
    }
    let count = user.daily_question_count || 0;
    if (lastDate !== today) {
      count = 0;
      await pool.query(
        'UPDATE users SET daily_question_count = 0, last_question_date = $1 WHERE id = $2',
        [today, userId]
      );
    }
    const limit = subscription.plan === 'premium' ? -1 : 20;

    // Progress – fallback if table missing
    let progress = { total: 0, completed: 0 };
    try {
      const progressRes = await pool.query(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
         FROM student_progress
         WHERE user_id = $1`,
        [userId]
      );
      if (progressRes.rows.length > 0) {
        progress = {
          total: parseInt(progressRes.rows[0].total || 0),
          completed: parseInt(progressRes.rows[0].completed || 0)
        };
      }
    } catch (progressErr) {
      console.error('❌ Progress query failed:', progressErr.message);
    }

    const response = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role || 'learner',
      grade: user.grade,
      country: countryRes.rows[0] || null,
      curriculum: curriculumRes.rows[0] || null,
      educationLevel: levelRes.rows[0] || null,
      subjects: subjectsRes.rows,
      subscription: {
        plan: subscription.plan || 'free',
        status: subscription.status || 'active',
        expires_at: subscription.expires_at || null
      },
      dailyQuestions: {
        used: count,
        limit: limit
      },
      progress: progress
    };

    res.json(response);
  } catch (err) {
    console.error('❌ /me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;