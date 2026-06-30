// ============================================================
// server/server.js – Full Paystack + Auth + Subscription
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Paystack = require('paystack')(process.env.PAYSTACK_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Middleware =====
app.use(cors());
app.use(express.json());

// Webhook must use raw body – place BEFORE express.json()
app.use('/paystack-webhook', express.raw({ type: 'application/json' }));

// Serve static files (your frontend)
app.use(express.static(path.join(__dirname, '../client')));

// ============================================================
//  IN‑MEMORY DATABASE (replace with real DB in production)
// ============================================================
const users = {};          // email -> { name, password, ... }
const subscriptions = {};  // userId -> { status, startDate, endDate }

// ---- DEFAULT TEST USER (always available) ----
users['samuellaphushu@gmail.com'] = {
  name: 'Samuel Laphushu',
  email: 'samuellaphushu@gmail.com',
  password: 'password123',
  country: 'South Africa',
  province: 'Gauteng',
  curriculum: 'CAPS',
  grade: '12',
  subjects: ['Mathematics', 'English', 'Life Sciences'],
  role: 'learner'
};

// ============================================================
//  AUTHENTICATION
// ============================================================
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Get subscription status
  const sub = subscriptions[email] || { status: 'trial', endDate: new Date(Date.now() + 3*24*60*60*1000) };
  const now = new Date();
  let status = sub.status;
  let daysRemaining = 0;
  if (sub.status === 'active' && now < sub.endDate) {
    status = 'active';
    daysRemaining = Math.ceil((sub.endDate - now) / (1000*60*60*24));
  } else if (sub.status === 'trial' && now < sub.endDate) {
    status = 'trial';
    daysRemaining = Math.ceil((sub.endDate - now) / (1000*60*60*24));
  } else {
    status = 'expired';
    daysRemaining = 0;
  }

  res.json({
    success: true,
    user: { id: email, ...user, password: undefined },
    token: 'mock-jwt-token',
    subscription: { status, daysRemaining }
  });
});

app.post('/signup', (req, res) => {
  const { email, password, name, country, province, curriculum, grade, school, subjects, role } = req.body;
  if (users[email]) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  users[email] = { name, email, password, country, province, curriculum, grade, school, subjects, role };
  res.json({ success: true });
});

app.post('/save-profile', (req, res) => {
  const { userId, name, country, grade, curriculum, province, subjects } = req.body;
  if (!users[userId]) return res.status(404).json({ error: 'User not found' });
  users[userId] = { ...users[userId], name, country, grade, curriculum, province, subjects };
  res.json({ success: true });
});

// ============================================================
//  PAYMENT & SUBSCRIPTION
// ============================================================

// —— Create a payment session ——
app.post('/create-payment', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) {
    return res.status(400).json({ error: 'Missing userId or email' });
  }

  try {
    const response = await Paystack.transaction.initialize({
      email,
      amount: 4999, // R49.99 in cents
      currency: 'ZAR',
      callback_url: process.env.PAYSTACK_CALLBACK_URL || 'https://synapses-uwh1.onrender.com/success',
      metadata: { userId }
    });

    res.json({
      authorization_url: response.data.authorization_url,
      reference: response.data.reference
    });
  } catch (error) {
    console.error('Paystack init error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Payment initiation failed. Please try again.' });
  }
});

// —— Webhook to confirm payment ——
app.post('/paystack-webhook', (req, res) => {
  const event = req.body;
  if (event.event === 'charge.success') {
    const userId = event.data.metadata?.userId;
    if (userId) {
      subscriptions[userId] = {
        status: 'active',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };
      console.log(`✅ Subscription activated for user ${userId}`);
    }
  }
  res.sendStatus(200);
});

// —— Check subscription status ——
app.get('/subscription-status/:userId', (req, res) => {
  const userId = req.params.userId;
  const sub = subscriptions[userId];

  if (!sub) {
    // Start a 3‑day trial for new users
    subscriptions[userId] = {
      status: 'trial',
      startDate: new Date(),
      endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    };
  }

  const currentSub = subscriptions[userId];
  const now = new Date();
  let status = 'expired';
  let daysRemaining = 0;

  if (currentSub.status === 'active' && now < currentSub.endDate) {
    status = 'active';
    daysRemaining = Math.ceil((currentSub.endDate - now) / (1000 * 60 * 60 * 24));
  } else if (currentSub.status === 'trial' && now < currentSub.endDate) {
    status = 'trial';
    daysRemaining = Math.ceil((currentSub.endDate - now) / (1000 * 60 * 60 * 24));
  } else {
    status = 'expired';
    daysRemaining = 0;
  }

  res.json({ status, daysRemaining: Math.max(0, daysRemaining) });
});

// —— Success redirect page ——
app.get('/success', (req, res) => {
  res.send(`
    <h1>✅ Payment successful!</h1>
    <p>Your subscription is now active. You can close this window and return to the app.</p>
    <a href="/">Go back to Leago</a>
  `);
});

// ============================================================
//  HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
//  START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ Leago AI Tutor running on port ${PORT}`);
  console.log(`💳 Payments enabled`);
  console.log(`🌍 Africa Education Engine active`);
});