// server/routes/chat.js
const express = require('express');
const { pool } = require('../db');
const router = express.Router();

async function checkSubscription(req, res, next) {
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

router.post('/', checkSubscription, async (req, res) => {
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
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: 'You are a tutor for African students.' }, { role: 'user', content: prompt }],
          max_tokens: 600,
          temperature: 0.7
        })
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
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens: 250, temperature: 0.6, do_sample: true, return_full_text: false }
        })
      });
      if (response.ok) {
        const data = await response.json();
        let reply = data[0]?.generated_text || '';
        reply = reply.replace(/^[\s\S]*?(\n|$)/, '').trim();
        if (reply) return res.json({ reply });
      }
    } catch (e) {}
  }

  res.json({
    reply: `📚 **Step-by-step for "${topic || subject}"**\n\n1. Read your textbook section.\n2. Identify key terms.\n3. Work through examples.\n4. Practice problems.\n5. Review difficult areas.`
  });
});

module.exports = router;