require('dotenv').config();
console.log('🚀 SERVER VERSION: 2.0.2 (Phase 2 - Final)');

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const subjectRoutes = require('./routes/subjects');
const topicsRoutes = require('./routes/topics');
const paymentRoutes = require('./routes/payments');
const chatRoutes = require('./routes/chat');
const chatUploadRoutes = require('./routes/chat-upload');
const progressRoutes = require('./routes/progress');
const dashboardRoutes = require('./routes/dashboard');
const lookupRoutes = require('./routes/lookup');   // ← new

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/topics', topicsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chat/upload', chatUploadRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/lookup', lookupRoutes);             // ← new

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dashboard.html'));
});

app.get('/health', (req, res) => res.send('OK'));
app.use(express.static(path.join(__dirname, '../client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Leago Academy v2 running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(err => {
  console.error('❌ SERVER FAILED TO START');
  console.error(err);
  console.error(err.stack);
  process.exit(1);
});