const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const authenticateToken = require('../middleware/auth');

// ===== SIGNUP =====
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, countryId, province, educationLevelId, grade, curriculumId, subjects, role } = req.body;
  if (!firstName || !lastName || !email || !password || !countryId || !educationLevelId || !grade || !curriculumId || !subjects) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    // Email uniqueness
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'This email already has an account. Please log in.' });
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, country_id, province, education_level_id, grade, curriculum_id, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, first_name, last_name, email, role`,
      [firstName, lastName, email, passwordHash, countryId, province, educationLevelId, grade, curriculumId, role || 'learner']
    );
    const user = result.rows[0];

    // Insert subjects (if provided)
    if (subjects && subjects.length > 0) {
      for (const subName of subjects) {
        // Find subject id by name (or insert? For now assume exists)
        const subRes = await pool.query('SELECT id FROM subjects WHERE name = $1', [subName]);
        if (subRes.rows.length > 0) {
          await pool.query(
            'INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [user.id, subRes.rows[0].id]
          );
        }
      }
    }

    res.status(201).json({ success: true, user });
  } catch(err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== LOGIN =====
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, password_hash, role, grade, country_id, province, education_level_id, curriculum_id, plan
       FROM users WHERE email = $1`,
      [email]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
    delete user.password_hash;

    const token = jwt.sign(
      { userId: user.id, role: user.role || 'learner' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, user, token });
  } catch(err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== GET /api/auth/me =====
router.get('/me', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const userResult = await pool.query(
      `SELECT 
        id, first_name, last_name, email, role, grade,
        country_id, province_id, education_level_id, curriculum_id,
        plan, daily_question_count, last_question_date
       FROM users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];

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
      `SELECT plan, status, start_date, expires_at FROM subscriptions WHERE user_id = $1`,
      [userId]
    );
    const subscription = subRes.rows[0] || { plan: 'free', status: 'active', expires_at: null };

    const today = new Date().toISOString().split('T')[0];
    const lastDate = user.last_question_date ? user.last_question_date.toISOString().split('T')[0] : null;
    let count = user.daily_question_count || 0;
    if (lastDate !== today) {
      count = 0;
      await pool.query('UPDATE users SET daily_question_count = 0, last_question_date = $1 WHERE id = $2', [today, userId]);
    }
    const limit = subscription.plan === 'premium' ? -1 : 20;

    const progressRes = await pool.query(
      `SELECT COUNT(*) as total, 
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
       FROM student_progress WHERE user_id = $1`,
      [userId]
    );
    const progress = progressRes.rows[0] || { total: 0, completed: 0 };

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
      progress: {
        total: parseInt(progress.total || 0),
        completed: parseInt(progress.completed || 0)
      }
    };

    res.json(response);
  } catch (err) {
    console.error('❌ /me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;