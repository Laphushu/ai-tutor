const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const auth = require('../middleware/auth');
const { buildAIPrompt } = require('../utils/ai');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true); else cb(new Error('File type not allowed'));
  }
});

async function extractTextFromFile(filePath, mimetype) {
  try {
    if (mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text || '';
    }
    return 'Image uploaded. Please describe what you need help with.';
  } catch(e) { return ''; }
}

router.post('/', auth, upload.single('file'), async (req, res) => {
  const userId = req.user.userId;
  const { message, subject, topic, conversationId } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const extractedText = await extractTextFromFile(file.path, file.mimetype);
    const prompt = Student uploaded a file with the following content:\n\n\n\nStudent's question: \n\nProvide a clear, step-by-step explanation based on the uploaded file.;
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    let fullResponse = '';
    if (DEEPSEEK_API_KEY) {
      try {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': Bearer , 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 2048, temperature: 0.7 })
        });
        if (response.ok) {
          const data = await response.json();
          fullResponse = data.choices?.[0]?.message?.content || '';
        }
      } catch(e) {}
    }
    if (!fullResponse) fullResponse = I've received your file. I can help you understand it. What specific questions do you have about this content?;
    const convId = conversationId || 'conv_' + Date.now() + '_' + userId;
    await pool.query(
      INSERT INTO chat_messages (user_id, role, content, subject, topic, conversation_id)
       VALUES (, 'user', , , , ),
      [userId, message || 'Uploaded file: ' + file.originalname, subject || 'General', topic || '', convId]
    );
    await pool.query(
      INSERT INTO chat_messages (user_id, role, content, subject, topic, conversation_id)
       VALUES (, 'assistant', , , , ),
      [userId, fullResponse, subject || 'General', topic || '', convId]
    );
    // fs.unlinkSync(file.path); // Uncomment to delete file after processing
    res.json({ reply: fullResponse, conversationId: convId });
  } catch(err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

module.exports = router;
