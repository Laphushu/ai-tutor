const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const math = require('mathjs');
const auth = require('../middleware/auth');
const { buildAIPrompt } = require('../utils/ai');

async function checkSubscription(req, res, next) {
  const userId = req.user.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await pool.query(
      'SELECT plan, daily_question_count, last_question_date FROM users WHERE id = ',
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];
    if (user.plan === 'premium') return next();
    const today = new Date().toISOString().split('T')[0];
    const lastDate = user.last_question_date ? user.last_question_date.toISOString().split('T')[0] : null;
    let count = user.daily_question_count || 0;
    if (lastDate !== today) {
      count = 0;
      await pool.query('UPDATE users SET daily_question_count = 0, last_question_date =  WHERE id = ', [today, userId]);
    }
    if (count >= 10) {
      return res.status(403).json({ error: 'limit_reached', message: 'You have reached your daily limit of 10 questions. Upgrade to Premium.' });
    }
    await pool.query('UPDATE users SET daily_question_count = , last_question_date =  WHERE id = ', [count + 1, today, userId]);
    req.user = { ...user, daily_question_count: count + 1 };
    next();
  } catch(err) {
    console.error('Subscription check error:', err.message);
    return next();
  }
}

router.post('/', auth, checkSubscription, async (req, res) => {
  const userId = req.user.userId;
  const { message, subject, topic, conversationId, grade, curriculum } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  // Math solver
  try {
    const isMath = /[0-9+\-*/().^]/.test(message) && !message.toLowerCase().includes('what is') && !message.toLowerCase().includes('teach');
    if (isMath) {
      let mathResult;
      if (message.includes('=')) {
        const sides = message.split('=');
        const left = sides[0].trim();
        const right = sides[1].trim();
        const leftResult = math.evaluate(left);
        const rightResult = math.evaluate(right);
        mathResult = leftResult === rightResult ? ✅ True:  =  : ❌ False:  =  ( ≠ );
      } else {
        const evaluated = math.evaluate(message);
        mathResult = ${message} = ;
      }
      return res.json({ reply: mathResult });
    }
  } catch(e) {}

  // Get history
  let history = [];
  let convId = conversationId;
  if (convId) {
    const histResult = await pool.query(
      SELECT role, content FROM chat_messages WHERE conversation_id =  AND user_id =  ORDER BY created_at ASC LIMIT 10,
      [convId, userId]
    );
    history = histResult.rows;
  } else {
    convId = 'conv_' + Date.now() + '_' + userId;
  }

  // Save user message
  await pool.query(
    INSERT INTO chat_messages (user_id, role, content, subject, topic, conversation_id)
     VALUES (, 'user', , , , ),
    [userId, message, subject || 'General', topic || '', convId]
  );

  const prompt = buildAIPrompt({
    message, subject: subject || 'General', topic: topic || '',
    grade: grade || req.user?.grade || 'unknown',
    curriculum: curriculum || req.user?.curriculum_id || 'CAPS',
    history
  });

  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  let fullResponse = '';
  if (DEEPSEEK_API_KEY) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': Bearer , 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048,
          temperature: 0.7
        })
      });
      if (response.ok) {
        const data = await response.json();
        fullResponse = data.choices?.[0]?.message?.content || '';
      }
    } catch(e) {}
  }
  if (!fullResponse) {
    fullResponse = 📚 I'm here to help you with "". Let's work through this together step by step. Could you tell me what you already know about this topic?;
  }

  await pool.query(
    INSERT INTO chat_messages (user_id, role, content, subject, topic, conversation_id)
     VALUES (, 'assistant', , , , ),
    [userId, fullResponse, subject || 'General', topic || '', convId]
  );

  res.json({ reply: fullResponse, conversationId: convId });
});

router.get('/history', auth, async (req, res) => {
  const userId = req.user.userId;
  const { conversationId } = req.query;
  if (!conversationId) {
    const result = await pool.query(
      SELECT DISTINCT conversation_id, MAX(created_at) as last_activity
       FROM chat_messages WHERE user_id = 
       GROUP BY conversation_id ORDER BY last_activity DESC LIMIT 20,
      [userId]
    );
    return res.json(result.rows);
  }
  const result = await pool.query(
    SELECT role, content, created_at FROM chat_messages
     WHERE user_id =  AND conversation_id = 
     ORDER BY created_at ASC LIMIT 50,
    [userId, conversationId]
  );
  res.json(result.rows);
});

module.exports = router;
