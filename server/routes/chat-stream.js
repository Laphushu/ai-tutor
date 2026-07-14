const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { getAIResponseStream } = require('../utils/ai');
const auth = require('../middleware/auth');

router.post('/', auth, async (req, res) => {
  const { userId } = req;
  const { message, subject, topic } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    const userResult = await pool.query(
      'SELECT grade, curriculum_id FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0] || {};

    await pool.query(
      'INSERT INTO chat_messages (user_id, role, content, subject, topic) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'user', message, subject || 'General', topic || '']
    );

    const historyResult = await pool.query(
      `SELECT role, content FROM chat_messages 
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 6`,
      [userId]
    );
    const history = historyResult.rows.reverse();

    let prompt = `You are Leago AI Tutor, a teacher for South African students.
You follow the ${user.curriculum_id === 1 ? 'CAPS' : 'IEB'} curriculum.
The student is in grade ${user.grade || 'unknown'}.

`;
    history.forEach(msg => {
      prompt += `${msg.role === 'user' ? 'Student' : 'Teacher'}: ${msg.content}\n`;
    });
    prompt += `Student: ${message}\nTeacher:`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await getAIResponseStream(prompt);
    let fullResponse = '';

    for await (const chunk of stream) {
      const text = chunk.toString();
      const lines = text.split('\n');
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

    await pool.query(
      'INSERT INTO chat_messages (user_id, role, content, subject, topic) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'assistant', fullResponse, subject || 'General', topic || '']
    );

    await pool.query(
      `UPDATE users SET daily_question_count = daily_question_count + 1 WHERE id = $1`,
      [userId]
    );

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat stream error:', err);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

module.exports = router;