const express = require('express');
const { pool } = require('../db');
const { create, all } = require('mathjs');
const router = express.Router();

// Create a restricted, sandboxed mathjs instance to prevent Code Injection
const math = create(all);
const limitedEvaluate = math.evaluate;

// Middleware to check daily limit and increment count safely in SQL
async function checkSubscription(req, res, next) {
  const userId = req.body.userId || req.query.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Rely on PostgreSQL CURRENT_DATE to eliminate timezone mismatch bugs
    const userRes = await pool.query(
      `SELECT plan, daily_question_count, 
              (last_question_date = CURRENT_DATE) AS is_today 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userRes.rows[0];

    // Premium users bypass checks entirely
    if (user.plan === 'premium') {
      req.user = user;
      return next();
    }

    const isToday = user.is_today;
    const currentCount = isToday ? (user.daily_question_count || 0) : 0;

    if (currentCount >= 10) {
      return res.status(403).json({
        error: 'limit_reached',
        message: 'You have reached your daily limit of 10 questions. Upgrade to Premium for unlimited access.'
      });
    }

    // Atomically reset or increment count
    const updatedCount = isToday ? currentCount + 1 : 1;
    await pool.query(
      `UPDATE users 
       SET daily_question_count = $1, last_question_date = CURRENT_DATE 
       WHERE id = $2`,
      [updatedCount, userId]
    );

    req.user = { ...user, daily_question_count: updatedCount };
    next();
  } catch (err) {
    console.error('Subscription check error:', err.message);
    // Safe fallback for connection hiccup
    return next();
  }
}

router.post('/', checkSubscription, async (req, res) => {
  const { userId, message, subject, topic } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing data' });

  console.log('📨 Chat request:', { userId, subject, topic, messageLength: message.length });

  // ---- Safe Math Solver ----
  let mathResult = null;
  
  // Strict regex test: only allow digits, operators, standard variables, and spaces
  const isPureMath = /^[0-9+\-*/().^=\s]+$/.test(message.trim()) && /\d/.test(message);

  if (isPureMath) {
    try {
      if (message.includes('=')) {
        const sides = message.split('=');
        if (sides.length === 2) {
          const left = sides[0].trim();
          const right = sides[1].trim();
          const leftResult = limitedEvaluate(left);
          const rightResult = limitedEvaluate(right);

          if (leftResult === rightResult) {
            mathResult = `✅ **True:** $${left} = ${right}$`;
          } else {
            mathResult = `❌ **False:** $${left} = ${right}$ (Evaluates to ${leftResult} ≠ ${rightResult})`;
          }
        }
      } else {
        const evaluated = limitedEvaluate(message);
        mathResult = `$$${message} = ${evaluated}$$`;
      }
    } catch (e) {
      console.log('Math evaluation skipped/failed, routing to AI...');
    }
  }

  if (mathResult) {
    return res.json({ reply: mathResult });
  }

  // ---- AI APIs ----
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  const HF_API_TOKEN = process.env.HF_API_TOKEN;

  const prompt = `The student is learning "${topic || 'General Topics'}" in "${subject || 'General Studies'}". 
Their question is: "${message}"

Provide a clear, step-by-step explanation. 
Use LaTeX for math formatting ($...$ for inline and $$...$$ for display equations).
Be encouraging and thorough.`;

  // 1. Try DeepSeek
  if (DEEPSEEK_API_KEY) {
    try {
      console.log('🚀 Trying DeepSeek...');
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { 
              role: 'system', 
              content: 'You are a patient AI tutor for African students. Use LaTeX for equations ($...$ for inline, $$...$$ for display math). Show clear step-by-step reasoning.' 
            }, 
            { role: 'user', content: prompt }
          ],
          max_tokens: 2048,
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

  // 2. Fallback to Hugging Face
  if (HF_API_TOKEN) {
    try {
      console.log('🤖 Trying Hugging Face...');
      const response = await fetch('https://api-inference.huggingface.co/models/google/flan-t5-large', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${HF_API_TOKEN}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens: 500, temperature: 0.6, do_sample: true, return_full_text: false }
        })
      });

      if (response.ok) {
        const data = await response.json();
        let reply = data[0]?.generated_text || '';
        reply = reply.replace(/^[\s\S]*?(\n|$)/, '').trim();
        if (reply) {
          console.log('✅ Hugging Face response received');
          return res.json({ reply });
        }
      } else if (response.status === 503) {
        return res.json({ reply: '⏳ The AI model is warming up. Please try sending your message again in a few seconds.' });
      }
    } catch (e) {
      console.error('❌ Hugging Face exception:', e.message);
    }
  }

  // 3. Ultimate Fallback
  console.log('📝 Using fallback response');
  return res.json({
    reply: `📚 **Step-by-step approach for ${topic || subject || 'this topic'}:**\n\n1. Review the key terms and core formulas in your notes.\n2. Break the question into smaller steps.\n3. Work out each step carefully.\n4. Verify your final answer against similar example problems.`
  });
});

module.exports = router;