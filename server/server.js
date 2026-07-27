require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

// ⚠️ MUST come BEFORE express.json() so webhooks get the raw unparsed body
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const subjectRoutes = require('./routes/subjects');
const paymentRoutes = require('./routes/payments');
const chatRoutes = require('./routes/chat');
const progressRoutes = require('./routes/progress');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/progress', progressRoutes);

app.get('/health', (req, res) => res.send('OK'));
app.use(express.static(path.join(__dirname, '../client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Leago Academy running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(err => {
  console.error('❌ Failed to start:', err.message);
  process.exit(1);
});