const express = require('express');
const { pool } = require('../db');
const math = require('mathjs');
const router = express.Router();

// Middleware to check daily limit and increment count
async function checkSubscription(req, res, next) {
  const userId = req.body.userId || req.query.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await pool.query(
      'SELECT plan, daily_question_count, last_question_date FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];

    // Premium users skip limit
    if (user.plan === 'premium') {
      return next();
    }

    // Free user: enforce 10 questions/day
    const today = new Date().toISOString().split('T')[0];
    const lastDate = user.last_question_date ? user.last_question_date.toISOString().split('T')[0] : null;
    let count = user.daily_question_count || 0;

    // Reset if new day
    if (lastDate !== today) {
      count = 0;
      await pool.query('UPDATE users SET daily_question_count = 0, last_question_date = $1 WHERE id = $2', [today, userId]);
    }

    if (count >= 10) {
      return res.status(403).json({
        error: 'limit_reached',
        message: 'You have reached your daily limit of 10 questions. Upgrade to Premium for unlimited access.'
      });
    }

    // Increment count
    await pool.query('UPDATE users SET daily_question_count = $1, last_question_date = $2 WHERE id = $3', [count + 1, today, userId]);
    req.user = { ...user, daily_question_count: count + 1 };
    next();
  } catch (err) {
    console.error('Subscription check error:', err.message);
    // Fallback: allow access for testing
    return next();
  }
}

router.post('/', checkSubscription, async (req, res) => {
  const { userId, message, subject, topic } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing data' });

  console.log('📨 Chat request:', { userId, subject, topic, messageLength: message.length });

  // ---- Math solver ----
  let mathResult = null;
  try {
    const isMath = /[0-9+\-*/().=]/.test(message) && !message.toLowerCase().includes('what is');
    if (isMath) {
      if (message.includes('=')) {
        const sides = message.split('=');
        const left = sides[0].trim();
        const right = sides[1].trim();
        const leftResult = math.evaluate(left);
        const rightResult = math.evaluate(right);
        if (leftResult === rightResult) {
          mathResult = `✅ True: ${left} = ${right}`;
        } else {
          mathResult = `❌ False: ${left} = ${right} (${leftResult} ≠ ${rightResult})`;
        }
      } else {
        const evaluated = math.evaluate(message);
        mathResult = `${message} = ${evaluated}`;
      }
    }
  } catch (e) {
    console.log('Math evaluation failed, falling back to AI');
  }

  if (mathResult) {
    return res.json({ reply: `$$ ${mathResult} $$` });
  }

  // ---- AI APIs ----
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  const HF_API_TOKEN = process.env.HF_API_TOKEN;

  if (DEEPSEEK_API_KEY) {
    try {
      const prompt = `Teach "${topic}" in "${subject}" step by step. Student asks: "${message}"`;
      console.log('🚀 Trying DeepSeek...');
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: 'You are a tutor for African students. Use LaTeX for equations (e.g., $x^2$).' }, { role: 'user', content: prompt }],
          max_tokens: 600,
          temperature: 0.7
        })
      });
      if (response.ok) {
        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content;
        if (reply) {
          console.log('✅ DeepSeek response received');
          return res.json({ reply });
        }
      } else {
        const errorText = await response.text();
        console.warn('⚠️ DeepSeek error:', response.status, errorText);
      }
    } catch (e) {
      console.warn('⚠️ DeepSeek exception:', e.message);
    }
  }

  if (HF_API_TOKEN) {
    try {
      const prompt = `Teach "${topic}" in "${subject}" step by step. Student asks: "${message}"`;
      console.log('🤖 Trying Hugging Face...');
      const response = await fetch('https://api-inference.huggingface.co/models/google/flan-t5-large', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${HF_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens: 250, temperature: 0.6, do_sample: true, return_full_text: false }
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Hugging Face error:', response.status, errorText);
        if (response.status === 503) {
          return res.json({ reply: '⏳ The AI model is loading. Please wait a few seconds and try again.' });
        }
      } else {
        const data = await response.json();
        let reply = data[0]?.generated_text || '';
        reply = reply.replace(/^[\s\S]*?(\n|$)/, '').trim();
        if (reply) {
          console.log('✅ Hugging Face response received');
          return res.json({ reply });
        }
      }
    } catch (e) {
      console.error('❌ Hugging Face exception:', e.message);
    }
  }

  // ---- Ultimate fallback ----
  console.log('📝 Using fallback response');
  res.json({
    reply: `📚 **Step-by-step for "${topic || subject}"**\n\n1. Read your textbook section.\n2. Identify key terms.\n3. Work through examples.\n4. Practice problems.\n5. Review difficult areas.`
  });
});

module.exports = router;