#!/bin/bash
echo "🔧 Fixing Leago Academy project structure..."

# 1. Create missing folders
mkdir -p server/middleware
mkdir -p server/utils
mkdir -p uploads/assignments

# 2. Move misplaced files to correct folders (if they exist)
[ -f server/past-papers.js ] && mv server/past-papers.js server/routes/
[ -f server/chat-stream.js ] && mv server/chat-stream.js server/routes/
[ -f server/lessons.js ] && mv server/lessons.js server/routes/
[ -f server/quizzes.js ] && mv server/quizzes.js server/routes/
[ -f server/assignments.js ] && mv server/assignments.js server/routes/
[ -f server/progress.js ] && mv server/progress.js server/routes/
[ -f server/admin.js ] && mv server/admin.js server/routes/

# 3. Create auth.js middleware
cat > server/middleware/auth.js << 'EOF'
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid token format' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role || 'learner';
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
EOF

# 4. Create admin.js middleware
cat > server/middleware/admin.js << 'EOF'
const { pool } = require('../db');

module.exports = async (req, res, next) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0 || !result.rows[0].is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
EOF

# 5. Create ai.js utility
cat > server/utils/ai.js << 'EOF'
const fetch = require('node-fetch');

async function getAIResponseStream(prompt) {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      stream: true,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errorText}`);
  }

  return response.body;
}

module.exports = { getAIResponseStream };
EOF

# 6. Ensure all route files exist (we already have them, but let's overwrite with correct versions)

# past-papers.js
cat > server/routes/past-papers.js << 'EOF'
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const multer = require('multer');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

router.get('/', auth, async (req, res) => {
  try {
    const { grade, subject, year } = req.query;
    let query = 'SELECT * FROM past_papers WHERE 1=1';
    const params = [];
    if (grade) { params.push(grade); query += ` AND grade = $${params.length}`; }
    if (subject) { params.push(subject); query += ` AND subject_id = $${params.length}`; }
    if (year) { params.push(year); query += ` AND year = $${params.length}`; }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, admin, upload.fields([
  { name: 'questionPdf', maxCount: 1 },
  { name: 'memoPdf', maxCount: 1 }
]), async (req, res) => {
  try {
    const { subject_id, grade, year, paper_number, mark_allocation } = req.body;
    const questionPdfUrl = req.files['questionPdf'] ? `/uploads/${req.files['questionPdf'][0].filename}` : null;
    const memoPdfUrl = req.files['memoPdf'] ? `/uploads/${req.files['memoPdf'][0].filename}` : null;
    const result = await pool.query(
      `INSERT INTO past_papers (subject_id, grade, year, paper_number, question_pdf_url, memo_pdf_url, mark_allocation)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [subject_id, grade, year, paper_number, questionPdfUrl, memoPdfUrl, mark_allocation]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
EOF

# lessons.js
cat > server/routes/lessons.js << 'EOF'
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

router.get('/', auth, async (req, res) => {
  try {
    const { subject, grade, topic } = req.query;
    let query = 'SELECT * FROM lessons WHERE 1=1';
    const params = [];
    if (subject) { params.push(subject); query += ` AND subject_id = $${params.length}`; }
    if (grade) { params.push(grade); query += ` AND grade = $${params.length}`; }
    if (topic) { params.push(`%${topic}%`); query += ` AND topic ILIKE $${params.length}`; }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM lessons WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
  res.json(result.rows[0]);
});

router.post('/', auth, admin, async (req, res) => {
  const { subject_id, grade, term, topic, content, summary, examples, practice_questions } = req.body;
  const result = await pool.query(
    `INSERT INTO lessons (subject_id, grade, term, topic, content, summary, examples, practice_questions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [subject_id, grade, term, topic, content, summary, examples, practice_questions]
  );
  res.status(201).json(result.rows[0]);
});

module.exports = router;
EOF

# quizzes.js
cat > server/routes/quizzes.js << 'EOF'
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

router.get('/', auth, async (req, res) => {
  try {
    const { subject, grade, topic } = req.query;
    let query = 'SELECT * FROM quizzes WHERE 1=1';
    const params = [];
    if (subject) { params.push(subject); query += ` AND subject_id = $${params.length}`; }
    if (grade) { params.push(grade); query += ` AND grade = $${params.length}`; }
    if (topic) { params.push(`%${topic}%`); query += ` AND topic ILIKE $${params.length}`; }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM quizzes WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Quiz not found' });
  res.json(result.rows[0]);
});

router.post('/submit', auth, async (req, res) => {
  const { quizId, answers } = req.body;
  const quizResult = await pool.query('SELECT questions FROM quizzes WHERE id = $1', [quizId]);
  if (quizResult.rows.length === 0) return res.status(404).json({ error: 'Quiz not found' });
  const questions = quizResult.rows[0].questions;
  let score = 0;
  const results = questions.map((q, i) => {
    const userAnswer = answers[i] || '';
    const correct = userAnswer === q.correct_answer;
    if (correct) score++;
    return { question: q.question, userAnswer, correct, explanation: q.explanation };
  });
  res.json({ score, total: questions.length, results });
});

router.post('/', auth, admin, async (req, res) => {
  const { subject_id, grade, topic, questions, difficulty } = req.body;
  const result = await pool.query(
    `INSERT INTO quizzes (subject_id, grade, topic, questions, difficulty)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [subject_id, grade, topic, questions, difficulty]
  );
  res.status(201).json(result.rows[0]);
});

module.exports = router;
EOF

# assignments.js
cat > server/routes/assignments.js << 'EOF'
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const multer = require('multer');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/assignments/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

router.post('/', auth, upload.single('file'), async (req, res) => {
  const { subject_id } = req.body;
  const fileUrl = req.file ? `/uploads/assignments/${req.file.filename}` : null;
  const result = await pool.query(
    `INSERT INTO assignments (user_id, subject_id, file_url, status)
     VALUES ($1, $2, $3, 'submitted') RETURNING *`,
    [req.userId, subject_id, fileUrl]
  );
  res.status(201).json(result.rows[0]);
});

router.get('/', auth, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM assignments WHERE user_id = $1 ORDER BY created_at DESC',
    [req.userId]
  );
  res.json(result.rows);
});

router.patch('/:id/grade', auth, admin, async (req, res) => {
  const { grade, feedback } = req.body;
  const result = await pool.query(
    `UPDATE assignments SET grade = $1, feedback = $2, status = 'graded' WHERE id = $3 RETURNING *`,
    [grade, feedback, req.params.id]
  );
  res.json(result.rows[0]);
});

module.exports = router;
EOF

# chat-stream.js
cat > server/routes/chat-stream.js << 'EOF'
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
EOF

echo "✅ All files created and moved to correct locations."
echo "📌 Now commit and push:"
echo "  git add ."
echo "  git commit -m 'Fix project structure: moved routes, added middleware and utils'"
echo "  git push"