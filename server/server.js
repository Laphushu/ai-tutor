require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");
const { Pool } = require("pg");

const app = express();

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

// ================= INIT TABLES (SAFE & COMPLETE) =================
async function initDB() {
  try {
    // 1. Drop existing tables (only if you want to reset – this ensures clean schema)
    // Comment the next two lines if you want to keep old data
    await db.query(`DROP TABLE IF EXISTS messages CASCADE`);
    await db.query(`DROP TABLE IF EXISTS subscriptions CASCADE`);
    await db.query(`DROP TABLE IF EXISTS users CASCADE`);

    // 2. Create users table (all columns)
    await db.query(`
      CREATE TABLE users (
        userId TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        country TEXT,
        grade TEXT,
        role TEXT DEFAULT 'learner',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 3. Create messages table
    await db.query(`
      CREATE TABLE messages (
        id SERIAL PRIMARY KEY,
        userId TEXT REFERENCES users(userId),
        role TEXT,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 4. Create subscriptions table
    await db.query(`
      CREATE TABLE subscriptions (
        userId TEXT PRIMARY KEY REFERENCES users(userId),
        status TEXT DEFAULT 'trial',
        startDate TIMESTAMP DEFAULT NOW(),
        stripeCustomerId TEXT,
        subscriptionEndDate TIMESTAMP,
        planType TEXT DEFAULT 'free'
      )
    `);

    console.log("✅ Database initialized with clean schema");
  } catch (err) {
    console.error("❌ DB init error:", err.message);
    // App will still run, but some features may fail
  }
}

// Run init (but don't crash if it fails)
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

    const userId = 'user_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    await db.query(
      `INSERT INTO users (userId, email, password, name, country, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, password, name, country, role || 'learner']
    );
    await ensureTrial(userId);

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
    const result = await db.query(
      `SELECT * FROM users WHERE email = $1 AND password = $2`,
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];
    await ensureTrial(user.userid);

    res.json({
      success: true,
      user: {
        id: user.userid,
        email: user.email,
        name: user.name,
        country: user.country,
        role: user.role,
        grade: user.grade
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
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

    const subResult = await db.query(`SELECT * FROM subscriptions WHERE userId = $1`, [userId]);
    const sub = subResult.rows[0];
    if (!sub) {
      return res.json({ reply: "Subscription error." });
    }

    const trialDays = 3;
    const start = new Date(sub.startdate || sub.startDate);
    const now = new Date();
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    if (sub.status === "trial" && diffDays > trialDays) {
      return res.json({ reply: "Your 3-day free trial has ended. Please subscribe." });
    }

    const messagesResult = await db.query(
      `SELECT role, content FROM messages WHERE userId = $1 ORDER BY id DESC LIMIT 10`,
      [userId]
    );

    const systemPrompt = `
You are Professor Synapse, a warm and patient teacher.

Teaching style:
1. Greet the student warmly.
2. Explain concepts clearly with examples.
3. Define new terms.
4. Show 2-3 worked examples.
5. Ask: "Do you understand? Shall I explain again?"
6. Give one simple question to check understanding.
7. Praise correct answers.

Student: ${user.name}
Grade: ${user.grade || 'Not set'}
Country: ${user.country}`;

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
      `SELECT status, startDate FROM subscriptions WHERE userId = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.json({ status: 'trial', daysRemaining: 3 });
    }
    const sub = result.rows[0];
    const now = new Date();
    const start = new Date(sub.startdate);
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, 3 - diffDays);
    let status = sub.status;
    if (sub.status === 'trial' && diffDays > 3) status = 'expired';
    res.json({ status, daysRemaining, planType: 'free' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= RESET DATABASE (emergency) =================
app.post("/reset-db", async (req, res) => {
  try {
    await initDB();
    res.json({ success: true, message: "Database reset successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= DASHBOARD (placeholder) =================
app.get("/dashboard.html", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dashboard</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:40px;">
      <h1>Welcome to Synapse!</h1>
      <p>You are logged in.</p>
      <p>Your AI tutor is ready.</p>
      <button onclick="localStorage.removeItem('synapse_user');window.location.href='/';">Logout</button>
      <script>
        const user = JSON.parse(localStorage.getItem('synapse_user') || 'null');
        if (!user) window.location.href = '/';
        document.querySelector('p').textContent = 'Welcome, ' + user.name + '!';
      </script>
    </body>
    </html>
  `);
});

// ================= START =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("✅ Synapse AI Tutor running on port " + PORT);
  console.log("🔐 Authentication ready");
});