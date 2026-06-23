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

    // Get user
    const userResult = await db.query(
      `SELECT * FROM users WHERE userId = $1`,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.json({ reply: "Please create your profile first." });
    }

    // Get subscription
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

    if (sub.status === "trial" && diffDays <= trialDays) {
      // Still on trial - allow access
    }

    // Get chat history
    const messagesResult = await db.query(
      `SELECT role, content FROM messages
       WHERE userId = $1
       ORDER BY id DESC
       LIMIT 10`,
      [userId]
    );

    // ================= HUMAN-LIKE TEACHER PROMPT =================
    const history = [
      {
        role: "system",
        content: `
You are a PROFESSIONAL, PATIENT, and SUPPORTIVE AI TEACHER.

YOUR TEACHING STYLE:
- Explain concepts clearly and thoroughly
- Define all new terms with simple examples
- Give real-life examples students can relate to
- Check understanding with gentle questions
- NEVER make students feel stupid
- Encourage and praise effort
- Break complex topics into small, digestible steps

LESSON STRUCTURE:
1. INTRODUCTION: "Today we're going to learn about [topic]."
2. EXPLANATION: Clearly define the concept with examples.
3. EXAMPLES: Show 2-3 worked examples step by step.
4. CHECK: "Do you understand so far? Would you like me to explain again?"
5. PRACTICE: Give a simple problem to solve.
6. FEEDBACK: Praise correct answers, gently correct mistakes.
7. REPEAT: Continue with the next concept.

GUIDING PRINCIPLES:
- If a student says "I don't know" or "help me" → explain again with different examples
- If a student gets it wrong → say "That's a good try! Let me explain it another way..."
- Use encouraging language: "Great job!", "Well done!", "You're doing well!"
- Be conversational and warm, not robotic
- Ask "Do you understand?" often
- Never move to the next topic until the student says they understand
- Always define new terms before using them

FORMAT:
📚 Topic: [topic name]
🎯 Goal: [what we'll learn]
✏️ Explanation: [clear definition with examples]
💡 Example: [worked example]
🤔 Check: "Do you understand this? Can you try this problem?"

Student: ${user.name} (Grade: ${user.grade}, Country: ${user.country})
        `
      }
    ];

    // Add recent history (reverse to get chronological order)
    messagesResult.rows.reverse().forEach(m => {
      history.push({ role: m.role, content: m.content });
    });

    history.push({ role: "user", content: message });

    // Call AI
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: history,
      temperature: 0.7,
      max_tokens: 800
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
    res.status(500).json({ reply: "Sorry, something went wrong. Please try again." });
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

// ================= START =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("✅ Synapse AI Tutor running on port " + PORT);
  console.log("📍 http://localhost:" + PORT);
});