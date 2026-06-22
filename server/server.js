require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { Pool } = require("pg");

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      name TEXT,
      country TEXT,
      grade TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      role TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      userId TEXT PRIMARY KEY,
      status TEXT DEFAULT 'trial',
      startDate DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ================= AI =================
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
});

// ================= HELPERS =================
function ensureTrial(userId) {
  db.run(
    `INSERT OR IGNORE INTO subscriptions (userId, status)
     VALUES (?, 'trial')`,
    [userId]
  );
}

// ================= PROFILE =================
app.post("/save-profile", (req, res) => {
  const { userId, name, country, grade } = req.body;

  db.run(
    `INSERT OR REPLACE INTO users (userId,name,country,grade)
     VALUES (?,?,?,?)`,
    [userId, name, country, grade],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// ================= CHAT =================
app.post("/chat", (req, res) => {
  const { userId, message } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ reply: "Missing userId or message" });
  }

  ensureTrial(userId);

  db.get(`SELECT * FROM users WHERE userId = ?`, [userId], (err, user) => {
    if (!user) {
      return res.json({ reply: "Please create your profile first." });
    }

    db.get(
      `SELECT * FROM subscriptions WHERE userId = ?`,
      [userId],
      (err, sub) => {
        if (!sub) {
          return res.json({ reply: "Subscription error." });
        }

        // ================= TRIAL CHECK =================
        const trialDays = 3;
        const start = new Date(sub.startDate);
        const now = new Date();
        const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));

        if (sub.status === "trial" && diffDays > trialDays) {
          return res.json({
            reply: "Your 3-day free trial has ended. Please subscribe."
          });
        }

        // ================= HISTORY =================
        db.all(
          `SELECT role, content FROM messages
           WHERE userId = ?
           ORDER BY id DESC
           LIMIT 10`,
          [userId],
          async (err, rows) => {

            const history = [
              {
                role: "system",
                content: `
You are STRICT AI TEACHER.

RULES:
- NEVER give full answers immediately
- ONE step at a time only
- ALWAYS ask a question after each step
- NO long paragraphs
- Keep answers short (max 2–4 lines)
- Wait for student response before continuing

FORMAT:

📚 Topic:
🎯 Goal:
✏️ Step:
🤔 Question:

If student says "I don't know":
give ONLY a hint, NOT the answer.

Student:
Name: ${user.name}
Grade: ${user.grade}
Country: ${user.country}
                `
              }
            ];

            rows.reverse().forEach(r => {
              history.push({ role: r.role, content: r.content });
            });

            history.push({ role: "user", content: message });

            try {
              const response = await client.chat.completions.create({
                model: "deepseek-chat",
                messages: history
              });

              const reply = response.choices[0].message.content;

              db.run(
                `INSERT INTO messages (userId, role, content)
                 VALUES (?,?,?)`,
                [userId, "user", message]
              );

              db.run(
                `INSERT INTO messages (userId, role, content)
                 VALUES (?,?,?)`,
                [userId, "assistant", reply]
              );

              res.json({ reply });

            } catch (error) {
              res.status(500).json({
                reply: "AI Error: " + error.message
              });
            }
          }
        );
      }
    );
  });
});

// ================= START =================
app.listen(5000, () => {
  console.log("AI School Server running on http://localhost:5000");
});