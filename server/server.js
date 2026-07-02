// server/server.js – full with subjects and university courses
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const { Resend } = require('resend');
const { pool, initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use('/paystack-webhook', express.raw({ type: 'application/json' }));
app.use(express.static(path.join(__dirname, '../client')));

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const SALT_ROUNDS = 10;

// Subscription middleware
async function requireActiveSubscription(req, res, next) {
  const userId = req.body.userId || req.query.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await pool.query('SELECT status, end_date FROM subscriptions WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) return res.status(403).json({ error: 'No subscription found' });
    const sub = result.rows[0];
    const now = new Date();
    if (sub.status === 'active' && now < sub.end_date) return next();
    if (sub.status === 'trial' && now < sub.end_date) return next();
    return res.status(403).json({ error: 'Subscription expired' });
  } catch (err) {
    console.warn('DB error – allowing access for testing');
    return next();
  }
}

// Admin middleware
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

// ===== STATIC DATA =====
const countries = [
  { id: 1, name: 'South Africa', code: 'ZA' },
  { id: 2, name: 'Kenya', code: 'KE' },
  { id: 3, name: 'Nigeria', code: 'NG' },
  { id: 4, name: 'Zimbabwe', code: 'ZW' },
  { id: 5, name: 'Botswana', code: 'BW' },
  { id: 6, name: 'Namibia', code: 'NA' },
  { id: 7, name: 'Ghana', code: 'GH' },
  { id: 8, name: 'Egypt', code: 'EG' },
  { id: 9, name: 'Uganda', code: 'UG' },
  { id: 10, name: 'Tanzania', code: 'TZ' },
  { id: 11, name: 'Zambia', code: 'ZM' },
  { id: 12, name: 'Mozambique', code: 'MZ' },
  { id: 13, name: 'Angola', code: 'AO' },
  { id: 14, name: 'Cameroon', code: 'CM' },
  { id: 15, name: 'Ethiopia', code: 'ET' },
  { id: 16, name: 'Morocco', code: 'MA' }
];

const educationLevels = [
  { id: 1, name: 'High School' },
  { id: 2, name: 'TVET College' },
  { id: 3, name: 'University' },
  { id: 4, name: 'Other' }
];

const grades = {
  1: [
    { id: 101, name: 'Grade 8', display: 'Grade 8' },
    { id: 102, name: 'Grade 9', display: 'Grade 9' },
    { id: 103, name: 'Grade 10', display: 'Grade 10' },
    { id: 104, name: 'Grade 11', display: 'Grade 11' },
    { id: 105, name: 'Grade 12', display: 'Grade 12' }
  ],
  2: [
    { id: 201, name: 'N1', display: 'N1' },
    { id: 202, name: 'N2', display: 'N2' },
    { id: 203, name: 'N3', display: 'N3' },
    { id: 204, name: 'N4', display: 'N4' },
    { id: 205, name: 'N5', display: 'N5' },
    { id: 206, name: 'N6', display: 'N6' }
  ],
  3: [
    { id: 301, name: 'First Year', display: 'First Year' },
    { id: 302, name: 'Second Year', display: 'Second Year' },
    { id: 303, name: 'Third Year', display: 'Third Year' },
    { id: 304, name: 'Fourth Year', display: 'Fourth Year' },
    { id: 305, name: 'Postgraduate', display: 'Postgraduate' }
  ],
  4: [
    { id: 401, name: 'Other', display: 'Other' }
  ]
};

const provinces = {
  1: ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'],
  2: ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika', 'Malindi', 'Kitale'],
  3: ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Port Harcourt', 'Kaduna', 'Enugu', 'Benin City'],
  4: ['Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Kwekwe', 'Masvingo', 'Chitungwiza'],
  5: ['Gaborone', 'Francistown', 'Molepolole', 'Serowe', 'Selibe Phikwe', 'Maun'],
  6: ['Windhoek', 'Walvis Bay', 'Swakopmund', 'Oshakati', 'Rundu', 'Otjiwarongo'],
  7: ['Accra', 'Kumasi', 'Tamale', 'Sekondi-Takoradi', 'Cape Coast', 'Tema'],
  8: ['Cairo', 'Alexandria', 'Giza', 'Shubra El Kheima', 'Port Said', 'Suez'],
  9: ['Kampala', 'Gulu', 'Mbarara', 'Jinja', 'Kasese', 'Arua'],
  10: ['Dar es Salaam', 'Mwanza', 'Arusha', 'Dodoma', 'Mbeya', 'Morogoro'],
  11: ['Lusaka', 'Kitwe', 'Ndola', 'Livingstone', 'Kabwe', 'Chingola'],
  12: ['Maputo', 'Matola', 'Beira', 'Nampula', 'Tete', 'Quelimane'],
  13: ['Luanda', 'Lubango', 'Benguela', 'Huambo', 'Namibe', 'Cabinda'],
  14: ['Douala', 'Yaoundé', 'Garoua', 'Bamenda', 'Maroua', 'Bafoussam'],
  15: ['Addis Ababa', 'Adama', 'Gondar', 'Mekele', 'Hawassa', 'Bahir Dar'],
  16: ['Casablanca', 'Rabat', 'Fes', 'Marrakech', 'Tangier', 'Agadir']
};

const curricula = [
  { id: 1, country_id: 1, name: 'CAPS' },
  { id: 2, country_id: 1, name: 'IEB' },
  { id: 3, country_id: 2, name: 'CBC' },
  { id: 4, country_id: 2, name: '8-4-4' },
  { id: 5, country_id: 3, name: 'WAEC' },
  { id: 6, country_id: 3, name: 'NECO' },
  { id: 7, country_id: 4, name: 'ZIMSEC' },
  { id: 8, country_id: 4, name: 'Cambridge' }
];

// ===== SUBJECT MAP (with university courses) =====
const subjectMap = {
  // CAPS (id:1) – High School grades
  1: {
    101: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    102: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    103: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    104: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    105: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    // College (University) – for grade 301-305 (First Year to Postgraduate)
    301: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    302: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    303: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    304: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    305: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management']
  },
  // IEB (id:2) – High School and College
  2: {
    103: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences'],
    104: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences'],
    105: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences'],
    301: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    302: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    303: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    304: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'],
    305: ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management']
  }
  // Add other curricula as needed...
};

// ===== API ENDPOINTS =====
app.get('/api/countries', (req, res) => res.json(countries));
app.get('/api/provinces/:countryId', (req, res) => {
  const id = parseInt(req.params.countryId);
  res.json(provinces[id] || []);
});
app.get('/api/education-levels', (req, res) => res.json(educationLevels));
app.get('/api/grades/:levelId', (req, res) => {
  const id = parseInt(req.params.levelId);
  res.json(grades[id] || []);
});
app.get('/api/curricula/:countryId', (req, res) => {
  const id = parseInt(req.params.countryId);
  res.json(curricula.filter(c => c.country_id === id));
});
app.get('/api/subjects/:curriculumId/:gradeId', (req, res) => {
  const cId = parseInt(req.params.curriculumId);
  const gId = parseInt(req.params.gradeId);
  const subs = subjectMap[cId]?.[gId] || [];
  res.json(subs);
});

// ============================================================
//  AUTH – Signup with subjects stored
// ============================================================
app.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, countryId, province, educationLevelId, curriculumId, gradeId, subjects, role } = req.body;
  if (!firstName || !lastName || !email || !password || !countryId || !educationLevelId || !curriculumId || !gradeId || !subjects || subjects.length === 0) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // Convert subjects array to JSON string for JSONB
    const subjectsJson = JSON.stringify(subjects);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, country_id, province, education_level_id, curriculum_id, grade_id, role, subjects)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [email, passwordHash, firstName, lastName, countryId, province, educationLevelId, curriculumId, gradeId, role || 'learner', subjectsJson]
    );
    const userId = result.rows[0].id;
    await pool.query(
      `INSERT INTO subscriptions (user_id, status, end_date) VALUES ($1, 'trial', NOW() + INTERVAL '3 days')`,
      [userId]
    );
    if (resend) {
      try {
        await resend.emails.send({
          from: 'Leago Academy <welcome@leagoacademy.co.za>',
          to: [email],
          subject: 'Welcome to Leago Academy!',
          html: `<h2>Hi ${firstName},</h2><p>Thanks for joining Leago Academy. You now have a 3‑day free trial. Upgrade to Premium anytime to unlock unlimited learning.</p>`
        });
      } catch (e) { console.warn('Email sending failed:', e.message); }
    }
    res.json({ success: true, userId });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Database error. Please try again later.' });
  }
});

// ============================================================
//  AUTH – Login returns subjects
// ============================================================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      console.warn(`Login attempt for non-existent email: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      console.warn(`Invalid password for email: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Get subscription
    const subResult = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1', [user.id]);
    let sub = subResult.rows[0];
    if (!sub) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, status, end_date) VALUES ($1, 'trial', NOW() + INTERVAL '3 days')`,
        [user.id]
      );
      sub = { status: 'trial', end_date: new Date(Date.now() + 3*24*60*60*1000) };
    }
    const now = new Date();
    let status = sub.status;
    let daysRemaining = 0;
    if (sub.status === 'active' && now < sub.end_date) {
      status = 'active';
      daysRemaining = Math.ceil((sub.end_date - now) / (1000*60*60*24));
    } else if (sub.status === 'trial' && now < sub.end_date) {
      status = 'trial';
      daysRemaining = Math.ceil((sub.end_date - now) / (1000*60*60*24));
    } else {
      status = 'expired';
      daysRemaining = 0;
    }
    const userData = { ...user };
    delete userData.password_hash;
    delete userData.password;
    // Parse subjects from JSONB
    userData.subjects = user.subjects || [];
    userData.subscription = { status, daysRemaining };
    res.json({ success: true, user: userData, token: 'mock' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Database error. Please try again later.' });
  }
});

// ============================================================
//  SUBSCRIPTION STATUS (unchanged)
// ============================================================
app.get('/subscription-status/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const result = await pool.query('SELECT status, end_date FROM subscriptions WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) return res.json({ status: 'trial', daysRemaining: 3 });
    const sub = result.rows[0];
    const now = new Date();
    let status = 'expired', days = 0;
    if (sub.status === 'active' && now < sub.end_date) {
      status = 'active';
      days = Math.ceil((sub.end_date - now) / (1000*60*60*24));
    } else if (sub.status === 'trial' && now < sub.end_date) {
      status = 'trial';
      days = Math.ceil((sub.end_date - now) / (1000*60*60*24));
    }
    res.json({ status, daysRemaining: Math.max(0, days) });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================================
//  PAYMENT & WEBHOOK (same)
// ============================================================
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
app.post('/create-payment', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing fields' });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Paystack not configured' });
  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, amount: 4999, currency: 'ZAR', callback_url: process.env.PAYSTACK_CALLBACK_URL || 'https://leagoacademy.co.za/success', metadata: { userId } })
    });
    const data = await response.json();
    if (!data.status) return res.status(400).json({ error: data.message });
    res.json({ authorization_url: data.data.authorization_url });
  } catch (e) {
    console.error('Payment error:', e.message);
    res.status(500).json({ error: 'Payment error' });
  }
});

app.post('/paystack-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = req.body;
  if (event.event === 'charge.success') {
    const userId = event.data.metadata?.userId;
    if (userId) {
      try {
        await pool.query(
          `INSERT INTO subscriptions (user_id, status, start_date, end_date)
           VALUES ($1, 'active', NOW(), NOW() + INTERVAL '30 days')
           ON CONFLICT (user_id) DO UPDATE SET status = 'active', start_date = NOW(), end_date = NOW() + INTERVAL '30 days'`,
          [userId]
        );
        console.log(`✅ Subscription activated for user ${userId}`);
      } catch (err) {
        console.error('Webhook error:', err.message);
      }
    }
  }
  res.sendStatus(200);
});

app.get('/success', (req, res) => res.send('<h1>Payment successful</h1><a href="/">Go back</a>'));

// ============================================================
//  PROGRESS TRACKING (unchanged)
// ============================================================
app.post('/api/progress', async (req, res) => {
  const { userId, subject, topic } = req.body;
  if (!userId || !subject || !topic) return res.status(400).json({ error: 'Missing fields' });
  try {
    await pool.query(
      `INSERT INTO progress (user_id, subject_name, topic_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, subject, topic]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/progress/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const result = await pool.query('SELECT subject_name, topic_name FROM progress WHERE user_id = $1', [userId]);
    const progress = {};
    result.rows.forEach(row => {
      if (!progress[row.subject_name]) progress[row.subject_name] = [];
      progress[row.subject_name].push(row.topic_name);
    });
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================================
//  AI CHAT (protected)
// ============================================================
app.post('/chat', requireActiveSubscription, async (req, res) => {
  const { userId, message, subject, topic } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing data' });
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  const HF_API_TOKEN = process.env.HF_API_TOKEN;
  if (DEEPSEEK_API_KEY) {
    try {
      const prompt = `Teach "${topic}" in "${subject}" step by step. Student asks: "${message}"`;
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: 'You are a tutor for African students.' }, { role: 'user', content: prompt }], max_tokens: 600, temperature: 0.7 })
      });
      if (response.ok) {
        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content;
        if (reply) return res.json({ reply });
      }
    } catch (e) {}
  }
  if (HF_API_TOKEN) {
    try {
      const prompt = `Teach "${topic}" in "${subject}" step by step. Student asks: "${message}"`;
      const response = await fetch('https://api-inference.huggingface.co/models/google/flan-t5-large', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${HF_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 250, temperature: 0.6, do_sample: true, return_full_text: false } })
      });
      if (response.ok) {
        const data = await response.json();
        let reply = data[0]?.generated_text || '';
        reply = reply.replace(/^[\s\S]*?(\n|$)/, '').trim();
        if (reply) return res.json({ reply });
      }
    } catch (e) {}
  }
  res.json({ reply: `📚 **Step-by-step for "${topic || subject}"**\n\n1. Read your textbook section.\n2. Identify key terms.\n3. Work through examples.\n4. Practice problems.\n5. Review difficult areas.` });
});

// ============================================================
//  ADMIN API (unchanged)
// ============================================================
app.get('/api/admin/users', requireAdmin, async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/admin/subscriptions', requireAdmin, async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================================
//  HEALTH
// ============================================================
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
//  TEST & ADMIN USERS
// ============================================================
async function ensureTestUser() {
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', ['test@leago.com']);
    if (result.rows.length === 0) {
      const hash = await bcrypt.hash('password123', SALT_ROUNDS);
      const res = await pool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, country_id, province, education_level_id, curriculum_id, grade_id, role, subjects)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        ['test@leago.com', hash, 'Test', 'User', 1, 'Gauteng', 1, 1, 104, 'learner', '[]']
      );
      const userId = res.rows[0].id;
      await pool.query(
        `INSERT INTO subscriptions (user_id, status, end_date) VALUES ($1, 'trial', NOW() + INTERVAL '3 days')`,
        [userId]
      );
      console.log('✅ Test user created: test@leago.com / password123');
    }
  } catch (err) { console.error('Failed to create test user:', err.message); }
}

async function ensureAdminUser() {
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@leago.com']);
    if (result.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', SALT_ROUNDS);
      const res = await pool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, country_id, province, education_level_id, curriculum_id, grade_id, role, subjects)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        ['admin@leago.com', hash, 'Admin', 'Leago', 1, 'Gauteng', 1, 1, 104, 'admin', '[]']
      );
      const userId = res.rows[0].id;
      await pool.query(
        `INSERT INTO subscriptions (user_id, status, end_date) VALUES ($1, 'active', NOW() + INTERVAL '365 days')`,
        [userId]
      );
      console.log('✅ Admin user created: admin@leago.com / admin123');
    }
  } catch (err) { console.error('Failed to create admin user:', err.message); }
}

// ============================================================
//  START
// ============================================================
initDB().then(async () => {
  await ensureTestUser();
  await ensureAdminUser();
  app.listen(PORT, () => {
    console.log(`✅ Leago AI Tutor running on port ${PORT}`);
    console.log(`💳 Payments ${PAYSTACK_SECRET ? 'enabled' : 'disabled'}`);
    console.log(`📧 Email ${resend ? 'enabled' : 'disabled'}`);
    console.log(`🌍 Onboarding ready with ${countries.length} countries`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
  app.listen(PORT, () => {
    console.log(`⚠️ Server started with database issues – some features may not work.`);
  });
});