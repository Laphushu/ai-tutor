const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const math = require('mathjs');
const authenticateToken = require('../middleware/auth');
const { buildAIPrompt } = require('../utils/ai');

// ===== HELPERS =====
async function checkAndIncrementDailyQuestion(userId) {
  const result = await pool.query(
    'SELECT plan, daily_question_count, last_question_date FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) throw new Error('User not found');
  const user = result.rows[0];
  const today = new Date().toISOString().split('T')[0];
  const lastDate = user.last_question_date ? user.last_question_date.toISOString().split('T')[0] : null;
  let count = user.daily_question_count || 0;
  if (lastDate !== today) {
    count = 0;
    await pool.query('UPDATE users SET daily_question_count = 0, last_question_date = $1 WHERE id = $2', [today, userId]);
  }
  const limit = user.plan === 'premium' ? -1 : 20;
  if (limit !== -1 && count >= limit) {
    return { allowed: false, limit, used: count };
  }
  await pool.query('UPDATE users SET daily_question_count = $1, last_question_date = $2 WHERE id = $3', [count + 1, today, userId]);
  return { allowed: true, limit, used: count + 1 };
}

// ===== POST /api/chat =====
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { message, subject_id, topic_id, conversation_id } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  // Daily limit
  const daily = await checkAndIncrementDailyQuestion(userId);
  if (!daily.allowed) {
    return res.status(403).json({ error: 'limit_reached', message: 'Daily question limit reached.' });
  }

  // Get user details for prompt
  const userRes = await pool.query(
    'SELECT first_name, grade, curriculum_id FROM users WHERE id = $1',
    [userId]
  );
  if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  const user = userRes.rows[0];
  const firstName = user.first_name || 'Student';
  const grade = user.grade || 'unknown';

  // Get subject and topic info
  let subjectName = null;
  let topicName = null;
  if (subject_id) {
    const subRes = await pool.query('SELECT name FROM subjects WHERE id = $1', [subject_id]);
    if (subRes.rows.length > 0) subjectName = subRes.rows[0].name;
  }
  if (topic_id) {
    const topRes = await pool.query('SELECT title FROM topics WHERE id = $1', [topic_id]);
    if (topRes.rows.length > 0) topicName = topRes.rows[0].title;
  }

  // Get curriculum
  let curriculum = null;
  if (user.curriculum_id) {
    const curRes = await pool.query('SELECT name FROM curricula WHERE id = $1', [user.curriculum_id]);
    if (curRes.rows.length > 0) curriculum = curRes.rows[0].name;
  }

  // Conversation handling
  let convId = conversation_id;
  if (!convId) {
    const title = subjectName ? `${subjectName} - ${topicName || 'General'}` : 'New Conversation';
    const result = await pool.query(
      `INSERT INTO conversations (user_id, subject_id, topic_id, title)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, subject_id, topic_id, title]
    );
    convId = result.rows[0].id;
  } else {
    // Verify ownership
    const ownerCheck = await pool.query('SELECT user_id FROM conversations WHERE id = $1', [convId]);
    if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (ownerCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [convId]);
  }

  // Save user message
  await pool.query(
    `INSERT INTO chat_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2)`,
    [convId, message]
  );

  // Get full conversation history (for AI context)
  const historyRes = await pool.query(
    `SELECT role, content FROM chat_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [convId]
  );
  const history = historyRes.rows;

  // Build prompt with full history
  const prompt = buildAIPrompt({
    firstName,
    grade,
    curriculum: curriculum || 'CAPS',
    subject: subjectName || 'General',
    topic: topicName || '',
    message,
    history: history.slice(0, -1) // exclude current user message (already included)
  });

  // Call DeepSeek API
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  let aiReply = '';
  if (DEEPSEEK_API_KEY) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048,
          temperature: 0.7
        })
      });
      if (response.ok) {
        const data = await response.json();
        aiReply = data.choices?.[0]?.message?.content || '';
      }
    } catch(e) {
      console.error('DeepSeek API error:', e);
    }
  }

  // Fallback
  if (!aiReply) {
    aiReply = `I'm sorry, I'm having trouble connecting to my knowledge base. Please try again in a moment. If the problem persists, you can ask your teacher or check your textbook.`;
  }

  // Save AI reply
  await pool.query(
    `INSERT INTO chat_messages (conversation_id, role, content)
     VALUES ($1, 'assistant', $2)`,
    [convId, aiReply]
  );

  // Update progress if topic known
  if (topic_id) {
    await pool.query(
      `INSERT INTO student_progress (user_id, subject_id, topic_id, status, last_opened)
       VALUES ($1, $2, $3, 'in_progress', NOW())
       ON CONFLICT (user_id, topic_id)
       DO UPDATE SET last_opened = NOW(), updated_at = NOW()`,
      [userId, subject_id, topic_id]
    );
  }

  res.json({ reply: aiReply, conversation_id: convId });
});

// ===== GET /api/chat/history (keep for backwards compatibility) =====
router.get('/history', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { conversation_id } = req.query;
  if (!conversation_id) {
    // List conversations
    const result = await pool.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id) as message_count,
              s.name as subject_name,
              t.title as topic_title
       FROM conversations c
       LEFT JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN topics t ON t.id = c.topic_id
       WHERE c.user_id = $1
       ORDER BY c.updated_at DESC
       LIMIT 20`,
      [userId]
    );
    return res.json(result.rows);
  }
  // Get messages (with ownership check)
  const convCheck = await pool.query('SELECT user_id FROM conversations WHERE id = $1', [conversation_id]);
  if (convCheck.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
  if (convCheck.rows[0].user_id !== userId) return res.status(403).json({ error: 'Access denied' });
  const result = await pool.query(
    `SELECT role, content, created_at FROM chat_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversation_id]
  );
  res.json(result.rows);
});

// ===== NEW: GET /api/conversations =====
router.get('/conversations', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              s.name as subject_name,
              t.title as topic_title,
              (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id) as message_count
       FROM conversations c
       LEFT JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN topics t ON t.id = c.topic_id
       WHERE c.user_id = $1
       ORDER BY c.updated_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Conversations list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== NEW: GET /api/conversations/:id =====
router.get('/conversations/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const convId = parseInt(req.params.id, 10);
  if (isNaN(convId)) return res.status(400).json({ error: 'Invalid conversation ID' });
  try {
    // Check ownership and get conversation details
    const convCheck = await pool.query(
      `SELECT c.id, c.title, c.subject_id, c.topic_id,
              s.name as subject_name,
              t.title as topic_title
       FROM conversations c
       LEFT JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN topics t ON t.id = c.topic_id
       WHERE c.id = $1 AND c.user_id = $2`,
      [convId, userId]
    );
    if (convCheck.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convCheck.rows[0];

    // Get messages
    const messages = await pool.query(
      `SELECT role, content, created_at FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [convId]
    );

    res.json({
      conversation: conv,
      messages: messages.rows
    });
  } catch (err) {
    console.error('Get conversation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== NEW: DELETE /api/conversations/:id =====
router.delete('/conversations/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const convId = parseInt(req.params.id, 10);
  if (isNaN(convId)) return res.status(400).json({ error: 'Invalid conversation ID' });
  try {
    // Verify ownership
    const ownerCheck = await pool.query('SELECT user_id FROM conversations WHERE id = $1', [convId]);
    if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (ownerCheck.rows[0].user_id !== userId) return res.status(403).json({ error: 'Access denied' });
    // Delete (cascade will remove messages)
    await pool.query('DELETE FROM conversations WHERE id = $1', [convId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete conversation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;