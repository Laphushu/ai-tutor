// ============================================================
// server/server.js – Paystack via direct fetch + Hugging Face AI
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Middleware =====
app.use(cors());
app.use(express.json());

// Webhook uses raw body – place BEFORE express.json()
app.use('/paystack-webhook', express.raw({ type: 'application/json' }));

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

// ============================================================
//  IN‑MEMORY DATABASE (replace with real DB in production)
// ============================================================
const users = {};
const subscriptions = {};

// ---- Default test user ----
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
  if (users[email]) return res.status(400).json({ error: 'Email already registered' });
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
//  PAYMENT & SUBSCRIPTION (using direct fetch to Paystack API)
// ============================================================

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
if (!PAYSTACK_SECRET) {
  console.warn('⚠️ PAYSTACK_SECRET_KEY not set – payments will fail');
}

// —— Create a payment session ——
app.post('/create-payment', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) {
    return res.status(400).json({ error: 'Missing userId or email' });
  }

  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: 'Paystack is not configured on the server.' });
  }

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: 4999, // R49.99 in cents
        currency: 'ZAR',
        callback_url: process.env.PAYSTACK_CALLBACK_URL || 'https://synapses-uwh1.onrender.com/success',
        metadata: { userId }
      })
    });

    const data = await response.json();
    if (!data.status) {
      console.error('Paystack error:', data.message);
      return res.status(400).json({ error: data.message || 'Payment initialization failed' });
    }

    res.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference
    });
  } catch (error) {
    console.error('Paystack request error:', error.message);
    res.status(500).json({ error: 'Payment service unavailable. Please try again.' });
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
  const sub = subscriptions[userId] || { status: 'trial', endDate: new Date(Date.now() + 3*24*60*60*1000) };
  const now = new Date();
  let status = 'expired', daysRemaining = 0;
  if (sub.status === 'active' && now < sub.endDate) {
    status = 'active';
    daysRemaining = Math.ceil((sub.endDate - now) / (1000*60*60*24));
  } else if (sub.status === 'trial' && now < sub.endDate) {
    status = 'trial';
    daysRemaining = Math.ceil((sub.endDate - now) / (1000*60*60*24));
  }
  res.json({ status, daysRemaining: Math.max(0, daysRemaining) });
});

app.get('/success', (req, res) => {
  res.send(`
    <h1>✅ Payment successful!</h1>
    <p>Your subscription is now active. You can close this window and return to the app.</p>
    <a href="/">Go back to Leago</a>
  `);
});

// ============================================================
//  🤖 AI TUTOR – Hugging Face Integration
// ============================================================
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const HF_MODEL = 'mistralai/Mistral-7B-Instruct-v0.1';

app.post('/chat', async (req, res) => {
  const { userId, message, subject, topic } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: 'Missing userId or message' });
  }

  if (!HF_API_TOKEN) {
    console.warn('⚠️ HF_API_TOKEN not set – falling back to mock response');
    return res.json({
      reply: `📚 **Step‑by‑step guide for "${topic || subject}":**\n\n1. Understand the basics of ${topic || subject}.\n2. Break it into smaller concepts.\n3. Practice with examples.\n4. Review and test your knowledge.\n\n*(To get a real AI response, set your HF_API_TOKEN environment variable.)*`
    });
  }

  try {
    const prompt = `You are a knowledgeable and patient tutor. Teach the student about "${topic}" in the context of "${subject}" step by step. The student asked: "${message}". Provide a clear, structured explanation with bullet points or numbered steps. Use simple language and include examples where helpful.`;

    const response = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 800,
          temperature: 0.7,
          top_p: 0.95,
          do_sample: true,
          return_full_text: false
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Hugging Face API error: ${response.status} - ${errorText}`);
      // If model is loading, wait and retry?
      if (response.status === 503) {
        return res.json({ reply: '⏳ The AI model is loading. Please wait a few seconds and try again.' });
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    let reply = data[0]?.generated_text || 'Sorry, I could not generate a response. Please try again.';
    reply = reply.replace(/^[\s\S]*?(\n|$)/, '').trim();
    res.json({ reply });
  } catch (error) {
    console.error('AI Tutor error:', error.message);
    res.status(500).json({ error: 'AI service unavailable. Please try again later.' });
  }
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
  console.log(`💳 Payments ${PAYSTACK_SECRET ? 'enabled' : 'disabled (secret missing)'}`);
  console.log(`🤖 AI Tutor ${HF_API_TOKEN ? 'enabled' : 'disabled (token missing)'}`);
  console.log(`🌍 Africa Education Engine active`);
});