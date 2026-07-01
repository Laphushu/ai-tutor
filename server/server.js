// ============================================================
// server/server.js – Full Student Onboarding + Paystack + AI
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use('/paystack-webhook', express.raw({ type: 'application/json' }));
app.use(express.static(path.join(__dirname, '../client')));

// ===== In-Memory Data =====
const users = {};
const subscriptions = {};
const progress = {};

// ---- Countries ----
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

// ---- Education Levels ----
const educationLevels = [
  { id: 1, name: 'High School', sort_order: 0 },
  { id: 2, name: 'TVET College', sort_order: 1 },
  { id: 3, name: 'University', sort_order: 2 },
  { id: 4, name: 'Other', sort_order: 3 }
];

// ---- Grades ----
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

// ---- Provinces ----
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

// ---- Curricula ----
const curricula = [
  { id: 1, country_id: 1, name: 'CAPS' },
  { id: 2, country_id: 1, name: 'IEB' },
  { id: 3, country_id: 2, name: 'CBC' },
  { id: 4, country_id: 2, name: '8-4-4' },
  { id: 5, country_id: 3, name: 'WAEC' },
  { id: 6, country_id: 3, name: 'NECO' },
  { id: 7, country_id: 4, name: 'ZIMSEC' },
  { id: 8, country_id: 4, name: 'Cambridge' },
  // Add more as needed
];

// ---- Subject Map (curriculumId -> gradeId -> [subject names]) ----
// For South Africa CAPS (curriculumId:1) all grades 8-12
const subjectMap = {
  1: {
    101: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    102: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    103: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    104: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
    105: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design']
  },
  2: { // IEB
    103: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences'],
    104: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences'],
    105: ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Drama', 'Visual Arts', 'Music', 'Design', 'Agricultural Sciences']
  }
  // Add more curricula and grades as needed.
};

// ===== API Endpoints =====
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

// ===== Auth =====
app.post('/signup', (req, res) => {
  const { firstName, lastName, email, password, countryId, province, educationLevelId, curriculumId, gradeId, subjects, role } = req.body;
  if (!firstName || !lastName || !email || !password || !countryId || !educationLevelId || !curriculumId || !gradeId || !subjects || subjects.length === 0) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (users[email]) return res.status(400).json({ error: 'Email already registered' });
  const userId = Date.now();
  const user = { id: userId, firstName, lastName, email, password, countryId, province, educationLevelId, curriculumId, gradeId, subjects, role: role || 'learner' };
  users[email] = user;
  subscriptions[userId] = { status: 'trial', endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) };
  progress[userId] = {};
  res.json({ success: true, userId });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const sub = subscriptions[user.id] || { status: 'trial', endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) };
  const now = new Date();
  let status = sub.status;
  let daysRemaining = 0;
  if (sub.status === 'active' && now < sub.endDate) { status = 'active'; daysRemaining = Math.ceil((sub.endDate - now) / (1000 * 60 * 60 * 24)); }
  else if (sub.status === 'trial' && now < sub.endDate) { status = 'trial'; daysRemaining = Math.ceil((sub.endDate - now) / (1000 * 60 * 60 * 24)); }
  else { status = 'expired'; daysRemaining = 0; }
  const userData = { ...user };
  delete userData.password;
  userData.subscription = { status, daysRemaining };
  res.json({ success: true, user: userData, token: 'mock' });
});

// ===== Payment & Subscription =====
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
  } catch (e) { res.status(500).json({ error: 'Payment error' }); }
});

app.post('/paystack-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = req.body;
  if (event.event === 'charge.success') {
    const userId = event.data.metadata?.userId;
    if (userId) subscriptions[userId] = { status: 'active', endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) };
  }
  res.sendStatus(200);
});

app.get('/subscription-status/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const sub = subscriptions[userId] || { status: 'trial', endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) };
  const now = new Date();
  let status = 'expired', days = 0;
  if (sub.status === 'active' && now < sub.endDate) { status = 'active'; days = Math.ceil((sub.endDate - now) / (1000 * 60 * 60 * 24)); }
  else if (sub.status === 'trial' && now < sub.endDate) { status = 'trial'; days = Math.ceil((sub.endDate - now) / (1000 * 60 * 60 * 24)); }
  res.json({ status, daysRemaining: Math.max(0, days) });
});

app.get('/success', (req, res) => res.send('<h1>Payment successful</h1><a href="/">Go back</a>'));

// ===== AI Chat =====
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const HF_API_TOKEN = process.env.HF_API_TOKEN;

app.post('/chat', async (req, res) => {
  const { userId, message, subject, topic } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing data' });
  // Try DeepSeek
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
  // Fallback to Hugging Face
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
  // Ultimate fallback
  res.json({ reply: `📚 **Step-by-step for "${topic || subject}"**\n\n1. Read your textbook section.\n2. Identify key terms.\n3. Work through examples.\n4. Practice problems.\n5. Review difficult areas.\n\nAsk a specific question!` });
});

// ===== Health =====
app.get('/health', (req, res) => res.send('OK'));

// ===== Start =====
app.listen(PORT, () => {
  console.log(`✅ Leago AI Tutor running on port ${PORT}`);
  console.log(`💳 Payments ${PAYSTACK_SECRET ? 'enabled' : 'disabled'}`);
  console.log(`🌍 Onboarding ready with ${countries.length} countries`);
});