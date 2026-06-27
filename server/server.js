require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");
const { Pool } = require("pg");
const Paystack = require('paystack')(process.env.PAYSTACK_SECRET_KEY);
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'https://synapses-uwh1.onrender.com',
    credentials: true
  }
});

// ================= RESEND EMAIL =================
const resend = new Resend(process.env.RESEND_API_KEY);

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json());

// ================= ROOT ROUTE =================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ================= POSTGRES =================
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= INIT TABLES =================
async function initDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        name TEXT,
        country TEXT,
        grade TEXT,
        role TEXT DEFAULT 'learner',
        is_admin BOOLEAN DEFAULT false,
        is_banned BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        userId TEXT,
        role TEXT,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        userId TEXT PRIMARY KEY,
        status TEXT DEFAULT 'trial',
        startDate TIMESTAMP DEFAULT NOW(),
        stripeCustomerId TEXT,
        subscriptionEndDate TIMESTAMP,
        planType TEXT DEFAULT 'free'
      )
    `);

    console.log("✅ Database ready with admin columns");
  } catch (err) {
    console.error("❌ DB init error:", err.message);
  }
}

initDB();

// ================= AI =================
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
});

// ================= HELPERS =================
async function ensureTrial(userId) {
  try {
    await db.query(
      `INSERT INTO subscriptions (userId, status)
       VALUES ($1, 'trial')
       ON CONFLICT (userId) DO NOTHING`,
      [userId]
    );
  } catch (err) {
    console.error("Trial error:", err.message);
  }
}

// ================= SEND EMAIL =================
async function sendEmail(to, subject, html) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Leago <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html,
    });
    if (error) { console.error('Email error:', error); return false; }
    console.log('✅ Email sent to', to);
    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
}

// ================= AUTH MIDDLEWARE =================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// ================= AUTH: SIGNUP =================
app.post("/signup", async (req, res) => {
  const { email, password, name, country, role } = req.body;
  if (!email || !password || !name || !country) {
    return res.status(400).json({ error: "All fields required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  try {
    const existing = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const userId = 'user_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    await db.query(
      `INSERT INTO users (userId, email, password, name, country, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, hashedPassword, name, country, role || 'learner']
    );
    await ensureTrial(userId);

    await sendEmail(
      email,
      '🎉 Welcome to Leago!',
      `
      <h1>Welcome ${name}!</h1>
      <p>Your AI tutor is ready to help you learn.</p>
      <p>You have a <strong>3-day free trial</strong> to explore all subjects.</p>
      <p><a href="https://synapses-uwh1.onrender.com" style="background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Start Learning Now →</a></p>
      `
    );

    res.json({
      success: true,
      user: { id: userId, email, name, country, role: role || 'learner' }
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ================= AUTH: LOGIN =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  try {
    const result = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const user = result.rows[0];

    if (user.is_banned) {
      return res.status(403).json({ error: "Your account has been suspended." });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.userid, email: user.email, is_admin: user.is_admin || false },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.userid,
        email: user.email,
        name: user.name,
        country: user.country,
        role: user.role,
        grade: user.grade,
        is_admin: user.is_admin || false,
        is_banned: user.is_banned || false
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= PROFILE UPDATE =================
app.post("/save-profile", async (req, res) => {
  const { userId, name, country, grade } = req.body;
  try {
    await db.query(
      `UPDATE users SET name = $1, country = $2, grade = $3 WHERE userId = $4`,
      [name, country, grade, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= CHAT =================
app.post("/chat", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ reply: "Missing userId or message" });
  }
  try {
    await ensureTrial(userId);
    const userResult = await db.query(`SELECT * FROM users WHERE userId = $1`, [userId]);
    const user = userResult.rows[0];
    if (!user) {
      return res.json({ reply: "Please create your profile first." });
    }
    if (user.is_banned) {
      return res.json({ reply: "Your account has been suspended. Please contact support." });
    }

    const subResult = await db.query(`SELECT * FROM subscriptions WHERE userId = $1`, [userId]);
    const sub = subResult.rows[0];
    if (!sub) {
      return res.json({ reply: "Subscription error." });
    }

    const trialDays = 3;
    const start = new Date(sub.startdate || sub.startDate);
    const now = new Date();
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));

    let isActive = false;
    if (sub.status === 'active' && sub.subscriptionenddate) {
      const endDate = new Date(sub.subscriptionenddate);
      if (now < endDate) {
        isActive = true;
      }
    }

    if (sub.status === 'trial' && diffDays > trialDays && !isActive) {
      return res.json({
        reply: "Your 3-day free trial has ended. Please subscribe to continue learning."
      });
    }
    if (sub.status === 'expired') {
      return res.json({
        reply: "Your subscription has expired. Please renew to continue learning."
      });
    }

    const messagesResult = await db.query(
      `SELECT role, content FROM messages WHERE userId = $1 ORDER BY id DESC LIMIT 10`,
      [userId]
    );

    const levelDesc = user.grade ? user.grade : 'Not specified';
    const systemPrompt = `
You are Leago, a warm, patient, and encouraging AI tutor.

CRITICAL RULES:
1. START WITH QUESTIONS, NOT LECTURES
2. ONE QUESTION AT A TIME
3. Explain concepts clearly with examples, define new terms, show 2-3 worked examples.
4. Check understanding: "Do you understand? Shall I explain again?"
5. Be encouraging: "That's a good try! Let me explain it another way..."
6. When the student demonstrates understanding, ask them to explain the concept in their own words.

Student: ${user.name}
Level: ${levelDesc}
Country: ${user.country}
`;

    const history = [{ role: "system", content: systemPrompt }];
    const reversed = messagesResult.rows.reverse();
    for (const m of reversed) {
      history.push({ role: m.role, content: m.content });
    }
    history.push({ role: "user", content: message });

    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: history,
      temperature: 0.7,
      max_tokens: 1000
    });

    const reply = response.choices[0].message.content;

    await db.query(
      `INSERT INTO messages (userId, role, content) VALUES ($1, $2, $3)`,
      [userId, "user", message]
    );
    await db.query(
      `INSERT INTO messages (userId, role, content) VALUES ($1, $2, $3)`,
      [userId, "assistant", reply]
    );

    io.emit('new_message', { userId, message, reply, timestamp: new Date() });

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ reply: "Sorry, something went wrong." });
  }
});

// ================= SUBSCRIPTION STATUS =================
app.get("/subscription-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      `SELECT status, startDate, subscriptionEndDate, planType FROM subscriptions WHERE userId = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.json({ status: 'trial', daysRemaining: 3, planType: 'free' });
    }
    const sub = result.rows[0];
    const now = new Date();
    const start = new Date(sub.startdate);
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, 3 - diffDays);

    let status = sub.status;
    let planType = sub.plantype || 'free';
    if (sub.status === 'active' && sub.subscriptionenddate) {
      const endDate = new Date(sub.subscriptionenddate);
      if (now > endDate) {
        status = 'expired';
        await db.query(`UPDATE subscriptions SET status = 'expired' WHERE userId = $1`, [userId]);
      }
    }
    if (sub.status === 'trial' && diffDays > 3) {
      status = 'expired';
      await db.query(`UPDATE subscriptions SET status = 'expired' WHERE userId = $1`, [userId]);
    }
    res.json({ status, daysRemaining, planType, subscriptionEndDate: sub.subscriptionenddate });
  } catch (err) {
    console.error("Status check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= PAYMENT =================
app.post("/create-payment", async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) {
    return res.status(400).json({ error: "Missing userId or email" });
  }
  try {
    const userResult = await db.query(`SELECT name, country, grade FROM users WHERE userId = $1`, [userId]);
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    let amount = 14999;
    let priceDisplay = 'R149.99';
    const isCollege = (user.grade === 'College' || user.grade === 'Tertiary');
    const isSouthAfrica = (user.country === 'South Africa');
    if (isCollege) {
      if (isSouthAfrica) { amount = 19999; priceDisplay = 'R199.99'; }
      else { amount = 29999; priceDisplay = 'R299.99'; }
    } else {
      if (isSouthAfrica) { amount = 4999; priceDisplay = 'R49.99'; }
      else { amount = 14999; priceDisplay = 'R149.99'; }
    }
    const response = await Paystack.transaction.initialize({
      email: email,
      amount: amount,
      currency: 'ZAR',
      metadata: { userId: userId, country: user.country, grade: user.grade || 'High School', price: amount / 100 },
      callback_url: `${process.env.PAYSTACK_CALLBACK_URL || 'https://synapses-uwh1.onrender.com'}/payment-callback`,
    });
    res.json({ success: true, authorization_url: response.data.authorization_url, reference: response.data.reference, price: priceDisplay, amount: amount / 100 });
  } catch (err) {
    console.error("Payment error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/payment-callback", async (req, res) => {
  const { reference } = req.query;
  if (!reference) { return res.status(400).send("Missing reference"); }
  try {
    const response = await Paystack.transaction.verify(reference);
    if (response.data.status === 'success') {
      const userId = response.data.metadata.userId;
      await db.query(
        `UPDATE subscriptions SET status = 'active', subscriptionEndDate = NOW() + INTERVAL '30 days', planType = 'premium' WHERE userId = $1`,
        [userId]
      );
      res.send(`
        <!DOCTYPE html>
        <html><head><title>Payment Successful</title>
        <style>body{font-family:sans-serif;text-align:center;padding:60px;background:#f0f4f8;}.card{background:white;padding:40px;border-radius:20px;max-width:500px;margin:0 auto;}h1{color:#22c55e;}.btn{display:inline-block;padding:14px 30px;background:#6366f1;color:white;text-decoration:none;border-radius:12px;margin-top:20px;}
        </style></head>
        <body><div class="card"><h1>✅ Payment Successful!</h1><p>Your subscription is now active. You have premium access for 30 days.</p><a href="/" class="btn">Go to Dashboard</a></div>
        <script>setTimeout(()=>{window.location.href='/'},5000);</script></body></html>
      `);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html><head><title>Payment Failed</title>
        <style>body{font-family:sans-serif;text-align:center;padding:60px;background:#f0f4f8;}.card{background:white;padding:40px;border-radius:20px;max-width:500px;margin:0 auto;}h1{color:#ef4444;}.btn{display:inline-block;padding:14px 30px;background:#6366f1;color:white;text-decoration:none;border-radius:12px;margin-top:20px;}
        </style></head>
        <body><div class="card"><h1>❌ Payment Failed</h1><p>Please try again.</p><a href="/" class="btn">Try Again</a></div></body></html>
      `);
    }
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).send("Verification failed");
  }
});

app.post("/paystack-webhook", express.json(), async (req, res) => {
  const event = req.body;
  if (event.event === 'charge.success') {
    const data = event.data;
    const userId = data.metadata.userId;
    try {
      await db.query(
        `UPDATE subscriptions SET status = 'active', subscriptionEndDate = NOW() + INTERVAL '30 days', planType = 'premium' WHERE userId = $1`,
        [userId]
      );
      console.log(`✅ Webhook: Subscription activated for ${userId}`);
    } catch (err) { console.error("Webhook error:", err); }
  }
  res.sendStatus(200);
});

// ================================================================
// 🚀 ADMIN ROUTES
// ================================================================

app.get("/admin/users", authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT userId, email, name, country, grade, role, is_admin, is_banned, created_at 
      FROM users 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/messages", authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT m.*, u.email, u.name 
      FROM messages m
      JOIN users u ON m.userId = u.userId
      ORDER BY m.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin messages error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/user/:userId/messages", authenticateToken, adminOnly, async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(`SELECT * FROM messages WHERE userId = $1 ORDER BY created_at ASC`, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin user messages error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/stats", authenticateToken, adminOnly, async (req, res) => {
  try {
    const totalUsers = await db.query(`SELECT COUNT(*) FROM users`);
    const totalMessages = await db.query(`SELECT COUNT(*) FROM messages`);
    const activeUsers = await db.query(
      `SELECT COUNT(DISTINCT userId) FROM messages WHERE created_at > NOW() - INTERVAL '7 days'`
    );
    const bannedUsers = await db.query(`SELECT COUNT(*) FROM users WHERE is_banned = true`);
    const messageTrend = await db.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count 
      FROM messages 
      WHERE created_at > NOW() - INTERVAL '7 days' 
      GROUP BY DATE(created_at) 
      ORDER BY date ASC
    `);
    const userTrend = await db.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count 
      FROM users 
      WHERE created_at > NOW() - INTERVAL '7 days' 
      GROUP BY DATE(created_at) 
      ORDER BY date ASC
    `);
    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      totalMessages: parseInt(totalMessages.rows[0].count),
      activeUsers7Days: parseInt(activeUsers.rows[0].count),
      bannedUsers: parseInt(bannedUsers.rows[0].count),
      messageTrend: messageTrend.rows,
      userTrend: userTrend.rows
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/user/:userId/toggle-ban", authenticateToken, adminOnly, async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(`SELECT is_banned FROM users WHERE userId = $1`, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const currentStatus = result.rows[0].is_banned;
    const newStatus = !currentStatus;
    await db.query(`UPDATE users SET is_banned = $1 WHERE userId = $2`, [newStatus, userId]);
    io.emit('user_banned', { userId, is_banned: newStatus });
    res.json({ success: true, is_banned: newStatus });
  } catch (err) {
    console.error("Toggle ban error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/export/messages", authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT m.*, u.email, u.name 
      FROM messages m
      JOIN users u ON m.userId = u.userId
      ORDER BY m.created_at DESC
    `);
    const rows = result.rows;
    if (rows.length === 0) {
      return res.status(404).json({ error: "No messages to export" });
    }
    let csv = 'ID,User,Email,Role,Content,Created At\n';
    rows.forEach(r => {
      const content = (r.content || '').replace(/,/g, ' ').replace(/\n/g, ' ');
      csv += `${r.id},${r.name || r.userId},${r.email || ''},${r.role},${content},${r.created_at}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=leago_chat_export_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// SOCKET.IO — Real-time admin updates
// ================================================================
io.on('connection', (socket) => {
  console.log('🔌 Admin connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 Admin disconnected:', socket.id);
  });
});

// ================================================================
// START
// ================================================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log("✅ Leago AI Tutor running on port " + PORT);
  console.log("🔐 Admin dashboard available at /admin.html");
  console.log("📊 Real-time analytics enabled");
});