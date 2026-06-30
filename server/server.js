// ============================================================
// server/server.js – DeepSeek AI + Paystack
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

// ============================================================
//  IN‑MEMORY DATABASE
// ============================================================
const users = {};
const subscriptions = {};

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
//  AUTH
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
//  PAYMENT
// ============================================================
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

app.post('/create-payment', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Paystack not configured.' });
  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: 4999,
        currency: 'ZAR',
        callback_url: process.env.PAYSTACK_CALLBACK_URL || 'https://synapses-uwh1.onrender.com/success',
        metadata: { userId }
      })
    });
    const data = await response.json();
    if (!data.status) {
      console.error('Paystack error:', data.message);
      return res.status(400).json({ error: data.message || 'Payment failed' });
    }
    res.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference
    });
  } catch (error) {
    console.error('Paystack error:', error.message);
    res.status(500).json({ error: 'Payment service unavailable.' });
  }
});

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
//  🤖 AI TUTOR – using DeepSeek API (you already have the key)
// ============================================================

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

app.post('/chat', async (req, res) => {
  const { userId, message, subject, topic } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: 'Missing userId or message' });
  }

  // If no DeepSeek key, fall back to Hugging Face or mock
  if (!DEEPSEEK_API_KEY) {
    console.warn('⚠️ DEEPSEEK_API_KEY missing – trying Hugging Face as fallback');
    return tryHuggingFace(req, res);
  }

  try {
    const prompt = `You are a knowledgeable tutor. Teach the student about "${topic}" in "${subject}" step by step. The student asked: "${message}". Provide a clear, structured explanation with bullet points or numbered steps. Use examples.`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a patient, knowledgeable tutor for African students following CAPS, IEB, and other curricula.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 800,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ DeepSeek error (${response.status}):`, errorText);
      // Fall back to Hugging Face
      return tryHuggingFace(req, res);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    if (!reply) {
      return tryHuggingFace(req, res);
    }
    res.json({ reply });
  } catch (error) {
    console.error('❌ DeepSeek error:', error.message);
    // Fall back to Hugging Face
    return tryHuggingFace(req, res);
  }
});

// ---- Hugging Face fallback (just in case) ----
async function tryHuggingFace(req, res) {
  const { userId, message, subject, topic } = req.body;
  const HF_TOKEN = process.env.HF_API_TOKEN;
  if (!HF_TOKEN) {
    return res.json({
      reply: `📚 **Step‑by‑step guide for "${topic || subject}":**\n\n1. Read the chapter section on ${topic || subject}.\n2. Identify key terms and definitions.\n3. Work through the examples.\n4. Try the practice problems.\n5. Review any areas you find difficult.\n\nIf you have a specific question, feel free to ask!`
    });
  }

  try {
    const prompt = `Teach about "${topic}" in "${subject}" step by step. Student asked: "${message}". Give a structured, easy-to-understand explanation.`;
    const response = await fetch('https://api-inference.huggingface.co/models/google/flan-t5-large', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 300,
          temperature: 0.6,
          do_sample: true,
          return_full_text: false
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ HF fallback error (${response.status}):`, errorText);
      return res.json({
        reply: `📚 **Step‑by‑step approach for "${topic || subject}":**\n\n1. Read the chapter on ${topic || subject}.\n2. Identify key terms.\n3. Work through the examples.\n4. Try the practice problems.\n5. Review any areas you find difficult.\n\nIf you have a specific question, feel free to ask!`
      });
    }

    const data = await response.json();
    let reply = data[0]?.generated_text || '';
    reply = reply.replace(/^[\s\S]*?(\n|$)/, '').trim();
    if (!reply) {
      reply = `📝 I suggest starting with the basics of "${topic}" and then moving to examples. Let me know what you'd like me to explain!`;
    }
    res.json({ reply });
  } catch (error) {
    console.error('❌ HF fallback error:', error.message);
    res.json({
      reply: `📚 **Step‑by‑step approach for "${topic || subject}":**\n\n1. Read the chapter on ${topic || subject}.\n2. Identify key terms.\n3. Work through the examples.\n4. Try the practice problems.\n5. Review any areas you find difficult.\n\nIf you have a specific question, feel free to ask!`
    });
  }
}

// ============================================================
//  HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
//  START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ Leago AI Tutor running on port ${PORT}`);
  console.log(`💳 Payments ${PAYSTACK_SECRET ? 'enabled' : 'disabled'}`);
  console.log(`🤖 AI Tutor ${DEEPSEEK_API_KEY ? 'enabled (DeepSeek)' : 'fallback mode'}`);
  console.log(`🌍 Africa Education Engine active`);
});