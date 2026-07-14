const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// GET papers (any logged-in user)
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
    console.error('Past papers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST (admin only)
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
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;