const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query('SELECT subjects FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.json([]);
    const subjects = result.rows[0].subjects;
    if (typeof subjects === 'string') {
      try { return res.json(JSON.parse(subjects)); } catch(e) { return res.json([]); }
    }
    res.json(subjects || []);
  } catch(err) { res.json([]); }
});

router.get('/topics', auth, async (req, res) => {
  const { subject, grade, curriculum } = req.query;
  if (!subject) return res.json([]);
  const topicMap = {
    'Mathematics': ['Algebra', 'Functions', 'Trigonometry', 'Calculus', 'Probability', 'Statistics', 'Geometry', 'Financial Maths'],
    'Physical Sciences': ['Mechanics', 'Thermodynamics', 'Electricity', 'Waves', 'Chemical Bonding', 'Organic Chemistry'],
    'Life Sciences': ['Cell Biology', 'Genetics', 'Ecology', 'Human Anatomy', 'Plant Physiology', 'Evolution'],
    'Accounting': ['Bookkeeping', 'Financial Statements', 'Budgeting', 'Taxation', 'Auditing'],
    'English': ['Grammar', 'Essay Writing', 'Comprehension', 'Literature', 'Poetry', 'Language'],
    'Geography': ['Climate', 'Maps', 'Geomorphology', 'Settlement', 'GIS', 'Population'],
    'History': ['Ancient Civilizations', 'Industrial Revolution', 'World Wars', 'Apartheid', 'African History'],
    'Information Technology': ['Programming', 'Networks', 'Cybersecurity', 'Databases', 'Web Development'],
    'Business Studies': ['Entrepreneurship', 'Marketing', 'HR', 'Finance', 'Business Ethics'],
    'Economics': ['Microeconomics', 'Macroeconomics', 'International Trade', 'Economic Development']
  };
  const topics = topicMap[subject] || ['Introduction', 'Basics', 'Intermediate', 'Advanced'];
  res.json(topics.map(t => ({ name: t })));
});

module.exports = router;