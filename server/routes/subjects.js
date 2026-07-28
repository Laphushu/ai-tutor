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
  // Comprehensive topic list aligned with CAPS and IEB
  const topicMap = {
    'Mathematics': [
      'Algebra', 'Functions', 'Trigonometry', 'Calculus', 'Probability',
      'Statistics', 'Geometry', 'Financial Maths', 'Euclidean Geometry',
      'Analytical Geometry', 'Sequences and Series', 'Exponents and Logarithms'
    ],
    'Physical Sciences': [
      'Mechanics', 'Thermodynamics', 'Electricity', 'Waves',
      'Chemical Bonding', 'Organic Chemistry', 'Acids and Bases',
      'Rates of Reaction', 'Chemical Equilibrium', 'Electrochemistry'
    ],
    'Life Sciences': [
      'Cell Biology', 'Genetics', 'Ecology', 'Human Anatomy',
      'Plant Physiology', 'Evolution', 'Biochemistry', 'Microbiology'
    ],
    'Accounting': [
      'Bookkeeping', 'Financial Statements', 'Budgeting',
      'Taxation', 'Auditing', 'Cost Accounting', 'Managerial Accounting'
    ],
    'English': [
      'Grammar', 'Essay Writing', 'Comprehension',
      'Literature', 'Poetry', 'Language', 'Vocabulary'
    ],
    'Geography': [
      'Climate', 'Maps', 'Geomorphology', 'Settlement',
      'GIS', 'Population', 'Economic Geography'
    ],
    'History': [
      'Ancient Civilizations', 'Industrial Revolution',
      'World Wars', 'Apartheid', 'African History', 'Colonialism'
    ],
    'Information Technology': [
      'Programming', 'Networks', 'Cybersecurity',
      'Databases', 'Web Development', 'Data Structures'
    ],
    'Business Studies': [
      'Entrepreneurship', 'Marketing', 'HR',
      'Finance', 'Business Ethics', 'Operations Management'
    ],
    'Economics': [
      'Microeconomics', 'Macroeconomics',
      'International Trade', 'Economic Development', 'Market Structures'
    ]
  };
  const topics = topicMap[subject] || ['Introduction', 'Basics', 'Intermediate', 'Advanced'];
  res.json(topics.map(t => ({ name: t })));
});

module.exports = router;