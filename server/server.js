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
        name TEXT,
        country TEXT,
        grade TEXT
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
        startDate TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("✅ Database tables ready");
  } catch (err) {
    console.error("❌ Database error:", err.message);
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

// ================= PROFILE =================
app.post("/save-profile", async (req, res) => {
  const { userId, name, country, grade } = req.body;

  try {
    await db.query(
      `INSERT INTO users (userId, name, country, grade)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (userId) DO UPDATE SET
       name = EXCLUDED.name,
       country = EXCLUDED.country,
       grade = EXCLUDED.grade`,
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
      `SELECT * FROM users WHERE userId = $1`,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.json({ reply: "Please create your profile first." });
    }

    const subResult = await db.query(
      `SELECT * FROM subscriptions WHERE userId = $1`,
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

    if (sub.status === "trial" && diffDays > trialDays) {
      return res.json({
        reply: "Your 3-day free trial has ended. Please subscribe to continue learning."
      });
    }

    // Get chat history
    const messagesResult = await db.query(
      `SELECT role, content FROM messages
       WHERE userId = $1
       ORDER BY id DESC
       LIMIT 10`,
      [userId]
    );

    // ================= FORCED HUMAN-LIKE TEACHER =================
    const systemPrompt = `
You are Professor Synapse, a warm and patient teacher.

IMPORTANT INSTRUCTIONS:
1. ALWAYS start with a greeting: "Hello [student name]! Today we'll learn about..."
2. EXPLAIN the concept fully before asking anything
3. DEFINE new terms with simple examples
4. SHOW at least 2 examples step by step
5. ASK: "Do you understand so far? Should I explain again?"
6. PRAISE: "Great job!", "Well done!"
7. If student says "I don't know", explain again with different examples

NEVER:
- Ask questions without explaining first
- Move to the next topic without checking understanding
- Make the student feel bad

Student: ${user.name}
Grade: ${user.grade}
Country: ${user.country}`;

    // Build conversation
    const history = [
      { role: "system", content: systemPrompt }
    ];

    const reversedMessages = messagesResult.rows.reverse();
    for (const m of reversedMessages) {
      history.push({ role: m.role, content: m.content });
    }

    history.push({ role: "user", content: message });

    // Call AI
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: history,
      temperature: 0.7,
      max_tokens: 1000
    });

    const reply = response.choices[0].message.content;

    // Save messages
    await db.query(
      `INSERT INTO messages (userId, role, content)
       VALUES ($1, $2, $3)`,
      [userId, "user", message]
    );

    await db.query(
      `INSERT INTO messages (userId, role, content)
       VALUES ($1, $2, $3)`,
      [userId, "assistant", reply]
    );

    res.json({ reply });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ 
      reply: "Sorry, something went wrong. Please try again." 
    });
  }
});

// ================= CHECK SUBSCRIPTION STATUS =================
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
    if (sub.status === 'trial' && diffDays > 3) {
      status = 'expired';
    }

    res.json({
      status: status,
      daysRemaining: daysRemaining,
      planType: 'free'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= RESET CHAT (for debugging) =================
app.post("/reset-chat/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    await db.query(`DELETE FROM messages WHERE userId = $1`, [userId]);
    res.json({ success: true, message: "Chat history cleared" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= START =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("✅ Synapse AI Tutor running on port " + PORT);
  console.log("🧠 Professor Synapse is ready!");
});