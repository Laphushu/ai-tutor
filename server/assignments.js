const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const multer = require('multer');
const path = require('path');

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

// Admin: grade assignment
router.patch('/:id/grade', auth, admin, async (req, res) => {
  const { grade, feedback } = req.body;
  const result = await pool.query(
    `UPDATE assignments SET grade = $1, feedback = $2, status = 'graded' WHERE id = $3 RETURNING *`,
    [grade, feedback, req.params.id]
  );
  res.json(result.rows[0]);
});

module.exports = router;