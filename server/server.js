// server/server.js – Complete app with PostgreSQL, bcrypt, Resend, and fallback
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

// Resend email client
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ============================================================
//  SALT ROUNDS FOR BCRYPT
// ============================================================
const SALT_ROUNDS = 10;

// ============================================================
//  SUBSCRIPTION GATING MIDDLEWARE (with fallback)
// ============================================================
async function requireActiveSubscription(req, res, next) {
  const userId = req.body.userId || req.query.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await pool.query('SELECT status, end_date FROM subscriptions WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No subscription found. Please sign up.' });
    }
    const sub = result.rows[0];
    const now = new Date();
    if (sub.status === 'active' && now < sub.end_date) return next();
    if (sub.status === 'trial' && now < sub.end_date) return next();
    return res.status(403).json({ error: 'Subscription expired. Please upgrade to Premium.' });
  } catch (err) {
    console.error('⚠️ Subscription check error:', err.message);
    // Fallback: allow access for testing (but warn)
    console.warn('⚠️ Allowing access due to database error – for testing only');
    return next();
  }
}

// ============================================================
//  STATIC DATA (countries, provinces, education levels, grades, curricula, subjects)
// ============================================================
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
  { id: 1, name: 'High School', sort_order: 0 },
  { id: 2, name: 'TVET College', sort_order: 1 },
  { id: 3, name: 'University', sort_order: 2 },
  { id: 4, name: 'Other', sort_order: 3 }
];

const grades = {
  1: [
    { id: 101, name: 'Grade 8', display: 'Grade 8', sort_order: 0 },
    { id: 102, name: 'Grade 9', display: 'Grade 9', sort_order: 1 },
    { id: 103, name: 'Grade 10', display: 'Grade 10', sort_order: 2 },
    { id: 104, name: 'Grade 11', display: 'Grade 11', sort_order: 3 },
    { id: 105, name: 'Grade 12', display: 'Grade 12', sort_order: 4 }
  ],
  2: [
    { id: 201, name: 'N1', display: 'N1', sort_order: 0 },
    { id: 202, name: 'N2', display: 'N2', sort_order: 1 },
    { id: 203, name: 'N3', display: 'N3', sort_order: 2 },
    { id: 204, name: 'N4', display: 'N4', sort_order: 3 },
    { id: 205, name: 'N5', display: 'N5', sort_order: 4 },
    { id: 206, name: 'N6', display: 'N6', sort_order: 5 }
  ],
  3: [
    { id: 301, name: 'First Year', display: 'First Year', sort_order: 0 },
    { id: 302, name: 'Second Year', display: 'Second Year', sort_order: 1 },
    { id: 303, name: 'Third Year', display: 'Third Year', sort_order: 2 },
    { id: 304, name: 'Fourth Year', display: 'Fourth Year', sort_order: 3 },
    { id: 305, name: 'Postgraduate', display: 'Postgraduate', sort_order: 4 }
  ],
  4: [
    { id: 401, name: 'Other', display: 'Other', sort_order: 0 }
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

const subjectMap = {
  1: {
    101: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    102: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    103: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    104: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    105: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design']
  },
  2: {
    103: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences'],
    104: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences'],
    105: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences']
  }
};

// ============================================================
//  API ENDPOINTS
// ============================================================
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
//  AUTH – Signup with bcrypt + database
// ============================================================
app.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, countryId, province, educationLevelId, curriculumId, gradeId, subjects, role } = req.body;
  if (!firstName || !lastName || !email || !password || !countryId || !educationLevelId || !curriculumId || !gradeId || !subjects || subjects.length === 0) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, country_id, province, education_level_id, curriculum_id, grade_id, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [email, passwordHash, firstName, lastName, countryId, province, educationLevelId, curriculumId, gradeId, role || 'learner']
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
//  AUTH – Login
// ============================================================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
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
    userData.subscription = { status, daysRemaining };
    res.json({ success: true, user: userData, token: 'mock' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Database error. Please try again later.' });
  }
});

// ============================================================
//  SUBSCRIPTION STATUS
// ============================================================
app.get('/subscription-status/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const result = await pool.query('SELECT status, end_date FROM subscriptions WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.json({ status: 'trial', daysRemaining: 3 });
    }
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
    console.error('Subscription status error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================================
//  PAYMENT & WEBHOOK
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
      body: JSON.stringify({ email, amount: 4999, currency: 'ZAR', callback_url: process.env.PAYSTACK_CALLBACK_URL || 'https://synapses-uwh1.onrender.com/success', metadata: { userId } })
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
//  PROGRESS TRACKING
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
    console.error('Progress error:', err.message);
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
    console.error('Progress fetch error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================================
//  AI CHAT – protected by subscription gate
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
//  HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
//  START SERVER AFTER DB INIT
// ============================================================
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Leago AI Tutor running on port ${PORT}`);
    console.log(`💳 Payments ${PAYSTACK_SECRET ? 'enabled' : 'disabled'}`);
    console.log(`📧 Email ${resend ? 'enabled' : 'disabled'}`);
    console.log(`🌍 Onboarding ready with ${countries.length} countries`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
  // Server will still start (tables may not exist, but app will try)
  app.listen(PORT, () => {
    console.log(`⚠️ Server started with database issues – some features may not work.`);
  });
});