const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/auth');

// ===== GET /api/dashboard =====
router.get('/', authenticateToken, async (req, res) => {
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
      `SELECT s.id, s.name, s.icon, s.color, s.description
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
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(completion_percentage) as total_percentage
       FROM student_progress WHERE user_id = $1`,
      [userId]
    );
    const progress = progressRes.rows[0] || { total: 0, completed: 0, total_percentage: 0 };

    const recentRes = await pool.query(
      `SELECT c.id, c.title, c.created_at, s.name as subject_name
       FROM conversations c
       LEFT JOIN subjects s ON s.id = c.subject_id
       WHERE c.user_id = $1
       ORDER BY c.updated_at DESC
       LIMIT 5`,
      [userId]
    );

    const messagesRes = await pool.query(
      `SELECT cm.content, cm.role, cm.created_at, c.title as conversation_title
       FROM chat_messages cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE c.user_id = $1
       ORDER BY cm.created_at DESC
       LIMIT 10`,
      [userId]
    );

    const response = {
      profile: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role || 'learner',
        grade: user.grade,
        country: countryRes.rows[0] || null,
        curriculum: curriculumRes.rows[0] || null,
        educationLevel: levelRes.rows[0] || null
      },
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
        completed: parseInt(progress.completed || 0),
        total_percentage: parseInt(progress.total_percentage || 0)
      },
      recentConversations: recentRes.rows,
      recentMessages: messagesRes.rows
    };

    res.json(response);
  } catch (err) {
    console.error('❌ Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;