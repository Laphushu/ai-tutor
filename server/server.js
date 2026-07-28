require('dotenv').config();
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
const paymentRoutes = require('./routes/payments');
const chatRoutes = require('./routes/chat');
const chatUploadRoutes = require('./routes/chat-upload');
const progressRoutes = require('./routes/progress');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chat/upload', chatUploadRoutes);
app.use('/api/progress', progressRoutes);

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
    console.log(✅ Leago Academy v2 running on port );
    console.log(🌍 Environment: );
  });
}).catch(err => {
  console.error('❌ Failed to start:', err.message);
  process.exit(1);
});
