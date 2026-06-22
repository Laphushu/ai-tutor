require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");            // <-- NEW: for serving HTML files
const OpenAI = require("openai");
const { Pool } = require("pg");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());

// IMPORTANT: Serve static files from the 'client' folder FIRST
app.use(express.static(path.join(__dirname, '../client')));

// Then, handle JSON requests (after static)
app.use(express.json());

// ================= ROOT ROUTE =================
// Now serves the actual index.html instead of a plain text message
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ================= POSTGRES =================
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= INIT TABLES + AUTO-MIGRATION =================
async function initDB() {
  // Users table
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      name TEXT,
      country TEXT,
      grade TEXT
    )
  `);

  // Messages table
  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      userId TEXT,
      role TEXT,
      content TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Subscriptions table (basic structure)
  await db.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      userId TEXT PRIMARY KEY,
      status TEXT DEFAULT 'trial',
      startDate TIMESTAMP DEFAULT NOW()
    )
  `);

  // ========== AUTO-MIGRATION: Add Stripe columns if missing ==========
  try {
    await db.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripeCustomerId TEXT`);
    await db.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS subscriptionEndDate TIMESTAMP`);
    await db.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS planType TEXT DEFAULT 'free'`);
    console.log("✅ Database migration successful (Stripe columns added)");
  } catch (err) {
    console.log("⚠️ Migration warning (columns might already exist):", err.message);
  }

  console.log("✅ Database tables ready");
}

initDB();

// ================= AI =================
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
});

// ================= HELPERS =================
async function ensureTrial(userId) {
  await db.query(
    `INSERT INTO subscriptions (userId, status)
     VALUES ($1, 'trial')
     ON CONFLICT (userId) DO NOTHING`,
    [userId]
  );
}

// ================= PROFILE =================
app.post("/save-profile", async (req, res) => {
  const { userId, name, country, grade } = req.body;

  try {
    await db.query(
      `INSERT INTO users (userId,name,country,grade)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (userId) DO UPDATE SET
       name=EXCLUDED.name,
       country=EXCLUDED.country,
       grade=EXCLUDED.grade`,
      [userId, name, country, grade]
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

    const userResult = await db.query(
      `SELECT * FROM users WHERE userId=$1`,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.json({ reply: "Please create your profile first." });
    }

    const subResult = await db.query(
      `SELECT * FROM subscriptions WHERE userId=$1`,
      [userId]
    );

    const sub = subResult.rows[0];

    if (!sub) {
      return res.json({ reply: "Subscription error." });
    }

    // Trial check
    const trialDays = 3;
    const start = new Date(sub.startdate || sub.startDate);
    const now = new Date();
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));

    // Check if paid subscription is active
    let isPaid = false;
    if (sub.status === 'active' && sub.subscriptionenddate) {
      const endDate = new Date(sub.subscriptionenddate);
      if (now < endDate) {
        isPaid = true;
      } else {
        await db.query(
          `UPDATE subscriptions SET status = 'expired' WHERE userId = $1`,
          [userId]
        );
      }
    }

    if (sub.status === "trial" && diffDays > trialDays) {
      return res.json({
        reply: "Your 3-day free trial has ended. Please subscribe to continue learning."
      });
    }

    if (!isPaid && sub.status !== 'trial') {
      return res.json({
        reply: "Your subscription is inactive. Please subscribe to continue."
      });
    }

    // get history
    const messagesResult = await db.query(
      `SELECT role, content FROM messages
       WHERE userId=$1
       ORDER BY id DESC
       LIMIT 10`,
      [userId]
    );

    const history = [
      {
        role: "system",
        content: `
You are STRICT AI TEACHER.

RULES:
- ONE step only
- ALWAYS ask a question
- NO full answers
- SHORT replies

FORMAT:
📚 Topic
🎯 Goal
✏️ Step
🤔 Question

Student:
Name: ${user.name}
Grade: ${user.grade}
Country: ${user.country}
        `
      }
    ];

    messagesResult.rows.reverse().forEach(m => {
      history.push({ role: m.role, content: m.content });
    });

    history.push({ role: "user", content: message });

    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: history
    });

    const reply = response.choices[0].message.content;

    await db.query(
      `INSERT INTO messages (userId, role, content)
       VALUES ($1,$2,$3)`,
      [userId, "user", message]
    );

    await db.query(
      `INSERT INTO messages (userId, role, content)
       VALUES ($1,$2,$3)`,
      [userId, "assistant", reply]
    );

    res.json({ reply });

  } catch (err) {
    res.status(500).json({ reply: err.message });
  }
});

// ================= CHECK SUBSCRIPTION STATUS =================
app.get("/subscription-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      `SELECT status, startDate, subscriptionEndDate, planType FROM subscriptions WHERE userId = $1`,
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
    if (sub.status === 'trial' && diffDays > 3) {
      status = 'expired';
    }

    res.json({
      status: status,
      daysRemaining: daysRemaining,
      planType: sub.plantype || 'free',
      subscriptionEndDate: sub.subscriptionenddate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= START =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Synapse AI Tutor running on port " + PORT);
  console.log("💳 Database auto-migration complete!");
  console.log("🚀 Frontend available at /");
});