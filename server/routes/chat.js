const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const math = require('mathjs');
const authenticateToken = require('../middleware/auth');

// Helper to get user context
async function getUserContext(userId) {
  const result = await pool.query(
    `SELECT grade, curriculum_id FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || {};
}

router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { message, subject, topic } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  console.log('📨 Chat request (user:', userId, 'subject:', subject, 'topic:', topic, 'message:', message.slice(0,50));

  // ---- Math solver ----
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
        mathResult = leftResult === rightResult ? `✅ True: ${left} = ${right}` : `❌ False: ${left} = ${right} (${leftResult} ≠ ${rightResult})`;
      } else {
        const evaluated = math.evaluate(message);
        mathResult = `${message} = ${evaluated}`;
      }
      // Save history
      await pool.query(
        `INSERT INTO chat_history (user_id, role, content, subject, topic) VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'user', message, subject || 'General', topic || '']
      );
      await pool.query(
        `INSERT INTO chat_history (user_id, role, content, subject, topic) VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'assistant', mathResult, subject || 'General', topic || '']
      );
      return res.json({ reply: mathResult });
    }
  } catch (e) {
    console.log('Math evaluation failed, falling back to AI');
  }

  // ---- Save user message ----
  await pool.query(
    `INSERT INTO chat_history (user_id, role, content, subject, topic) VALUES ($1, $2, $3, $4, $5)`,
    [userId, 'user', message, subject || 'General', topic || '']
  );

  // ---- Get user context ----
  const user = await getUserContext(userId);
  const curriculumName = user.curriculum_id === 1 ? 'CAPS' : 'IEB';

  // ---- Build prompt ----
  const prompt = `You are Leago AI Tutor, a friendly and encouraging teacher for African students. The student is in grade ${user.grade || 'unknown'}, following the ${curriculumName} curriculum. Subject: ${subject || 'General'}. Topic: ${topic || 'general'}. 

Teach step by step. Never give the answer directly. Ask guiding questions. Use LaTeX for equations with $...$ for inline and $$...$$ for display. Use Markdown for formatting.

Student's question: ${message}`;

  // ---- DeepSeek API (streaming) ----
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  let fullResponse = '';

  if (DEEPSEEK_API_KEY) {
    try {
      console.log('🚀 Trying DeepSeek streaming...');
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4096,
          temperature: 0.7,
          stream: true
        })
      });

      if (!response.ok) throw new Error(`DeepSeek error: ${response.status}`);

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullResponse += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {}
          }
        }
      }

      // Save assistant message
      await pool.query(
        `INSERT INTO chat_history (user_id, role, content, subject, topic) VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'assistant', fullResponse, subject || 'General', topic || '']
      );

      // Update question count
      await pool.query(
        `UPDATE users SET daily_question_count = daily_question_count + 1 WHERE id = $1`,
        [userId]
      );

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    } catch (err) {
      console.error('DeepSeek streaming error:', err);
      // fallback to non-streaming
    }
  }

  // ---- Fallback ----
  const fallbackReply = `📚 I'm here to help you with "${topic || subject}". Let's work through this together step by step. Could you tell me what you already know about this topic?`;
  fullResponse = fallbackReply;
  await pool.query(
    `INSERT INTO chat_history (user_id, role, content, subject, topic) VALUES ($1, $2, $3, $4, $5)`,
    [userId, 'assistant', fallbackReply, subject || 'General', topic || '']
  );
  await pool.query(
    `UPDATE users SET daily_question_count = daily_question_count + 1 WHERE id = $1`,
    [userId]
  );

  res.json({ reply: fallbackReply });
});

// ---- Get chat history ----
router.get('/history', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const result = await pool.query(
    `SELECT id, role, content, subject, topic, created_at FROM chat_history
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  res.json(result.rows.reverse());
});

// ---- Clear chat history ----
router.delete('/history', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  await pool.query(`DELETE FROM chat_history WHERE user_id = $1`, [userId]);
  res.json({ success: true });
});

module.exports = router;