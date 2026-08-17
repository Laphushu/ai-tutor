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
const lookupRoutes = require('./routes/lookup');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/topics', topicsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chat/upload', chatUploadRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/lookup', lookupRoutes);

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dashboard.html'));
});

app.get('/health', (req, res) => res.send('OK'));

// ===== PUBLIC STATIC FILES =====
// ads.txt must be served as plain text
app.get('/ads.txt', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/ads.txt'));
});
// robots.txt must be served as plain text
app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/robots.txt'));
});
// sitemap.xml must be served as XML
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/sitemap.xml'));
});

// ===== PUBLIC PAGES =====
// Each route returns the corresponding HTML page, not index.html
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/terms.html'));
});
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/about.html'));
});
app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/contact.html'));
});
app.get('/faq', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/faq.html'));
});

// ===== STATIC FILES & CATCH‑ALL =====
// Serve all static assets from the client folder
app.use(express.static(path.join(__dirname, '../client')));

// Catch‑all route: returns the main index.html for any unmatched route
// This must come AFTER all explicit routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Initialize database and start server
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