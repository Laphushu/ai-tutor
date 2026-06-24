require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");
const { Pool } = require("pg");
const Paystack = require('paystack')(process.env.PAYSTACK_SECRET_KEY);

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
        email TEXT UNIQUE,
        password TEXT,
        name TEXT,
        country TEXT,
        grade TEXT,
        role TEXT DEFAULT 'learner',
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

    console.log("✅ Database ready with payment columns");
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

// ================= CHAT (HUMAN-LIKE CONVERSATIONAL TUTOR) =================
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

    // ===== SUBSCRIPTION CHECK =====
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

    // Get chat history
    const messagesResult = await db.query(
      `SELECT role, content FROM messages WHERE userId = $1 ORDER BY id DESC LIMIT 10`,
      [userId]
    );

    // ===== NEW HUMAN-LIKE CONVERSATIONAL SYSTEM PROMPT =====
    const systemPrompt = `
You are Leago, a warm, patient, and encouraging AI tutor. Your goal is to help students learn through natural conversation.

CRITICAL RULES FOR EVERY CONVERSATION:

1. START WITH QUESTIONS, NOT LECTURES:
   - NEVER start with a long explanation.
   - ALWAYS start by asking the student what they want to learn.
   - Then ask about their level (high school, college, professional).
   - Then ask what they already know about the topic.
   - Only after you have this information, begin teaching.

2. ONE QUESTION AT A TIME:
   - Never ask multiple questions in one message.
   - Wait for the student's response before asking the next question.
   - This keeps the conversation natural and not overwhelming.

3. TEACHING STYLE:
   - Explain concepts clearly with real-world examples.
   - Define new terms when they appear.
   - Show 2-3 worked examples step by step.
   - Check understanding: "Do you understand? Shall I explain again?"
   - Give one simple question to check understanding.
   - Praise correct answers: "Great job!", "Well done!"

4. IF STUDENT STRUGGLES:
   - Be encouraging: "That's a good try! Let me explain it another way..."
   - Give hints instead of the answer.
   - Ask them to explain their thinking.

5. END THE SESSION:
   - When the student demonstrates understanding, ask them to explain the concept in their own words.
   - Tell them you're here to help if they have further questions.

CONVERSATION STARTER TEMPLATE:
"Hi [student name]! I'm Leago, your AI tutor. I'm here to help you learn. What topic would you like to explore today?"

Then wait for response, then ask:
"Great! To help me tailor this to you, are you a high school student, college student, or professional?"

Then wait for response, then ask:
"Perfect! What do you already know about [topic]? This helps me know where to start."

Then begin teaching based on their level and prior knowledge.

Student: ${user.name}
Level: ${user.grade || 'Not specified'}
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
        await db.query(
          `UPDATE subscriptions SET status = 'expired' WHERE userId = $1`,
          [userId]
        );
      }
    }

    if (sub.status === 'trial' && diffDays > 3) {
      status = 'expired';
      await db.query(
        `UPDATE subscriptions SET status = 'expired' WHERE userId = $1`,
        [userId]
      );
    }

    res.json({
      status: status,
      daysRemaining: daysRemaining,
      planType: planType,
      subscriptionEndDate: sub.subscriptionenddate
    });
  } catch (err) {
    console.error("Status check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= PAYMENT: Create Transaction =================
app.post("/create-payment", async (req, res) => {
  const { userId, email } = req.body;

  if (!userId || !email) {
    return res.status(400).json({ error: "Missing userId or email" });
  }

  try {
    const userResult = await db.query(
      `SELECT name, country, grade FROM users WHERE userId = $1`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // ===== PRICING: Based on Country + Level =====
    let amount = 14999; // default international high school
    let priceDisplay = 'R149.99';

    const isCollege = (user.grade === 'College' || user.grade === 'Tertiary');
    const isSouthAfrica = (user.country === 'South Africa');

    if (isCollege) {
      if (isSouthAfrica) {
        amount = 19999; // R199.99 for SA college
        priceDisplay = 'R199.99';
      } else {
        amount = 29999; // R299.99 for international college
        priceDisplay = 'R299.99';
      }
    } else {
      if (isSouthAfrica) {
        amount = 4999; // R49.99 for SA high school
        priceDisplay = 'R49.99';
      } else {
        amount = 14999; // R149.99 for international high school
        priceDisplay = 'R149.99';
      }
    }

    const response = await Paystack.transaction.initialize({
      email: email,
      amount: amount,
      currency: 'ZAR',
      metadata: {
        userId: userId,
        country: user.country,
        grade: user.grade || 'High School',
        price: amount / 100
      },
      callback_url: `${process.env.PAYSTACK_CALLBACK_URL || 'https://synapses-uwh1.onrender.com'}/payment-callback`,
    });

    res.json({
      success: true,
      authorization_url: response.data.authorization_url,
      reference: response.data.reference,
      price: priceDisplay,
      amount: amount / 100
    });

  } catch (err) {
    console.error("Payment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= PAYMENT: Callback =================
app.get("/payment-callback", async (req, res) => {
  const { reference } = req.query;
  if (!reference) {
    return res.status(400).send("Missing reference");
  }

  try {
    const response = await Paystack.transaction.verify(reference);
    if (response.data.status === 'success') {
      const userId = response.data.metadata.userId;
      await db.query(
        `UPDATE subscriptions 
         SET status = 'active', 
             subscriptionEndDate = NOW() + INTERVAL '30 days',
             planType = 'premium'
         WHERE userId = $1`,
        [userId]
      );
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Payment Successful</title>
        <style>
          body { font-family: sans-serif; text-align: center; padding: 60px; background: #f0f4f8; }
          .card { background: white; padding: 40px; border-radius: 20px; max-width: 500px; margin: 0 auto; }
          h1 { color: #22c55e; }
          .btn { display: inline-block; padding: 14px 30px; background: #6366f1; color: white; text-decoration: none; border-radius: 12px; margin-top: 20px; }
        </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Payment Successful!</h1>
            <p>Your subscription is now active. You have premium access for 30 days.</p>
            <a href="/" class="btn">Go to Dashboard</a>
          </div>
          <script>setTimeout(() => { window.location.href = '/'; }, 5000);</script>
        </body>
        </html>
      `);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Payment Failed</title>
        <style>
          body { font-family: sans-serif; text-align: center; padding: 60px; background: #f0f4f8; }
          .card { background: white; padding: 40px; border-radius: 20px; max-width: 500px; margin: 0 auto; }
          h1 { color: #ef4444; }
          .btn { display: inline-block; padding: 14px 30px; background: #6366f1; color: white; text-decoration: none; border-radius: 12px; margin-top: 20px; }
        </style>
        </head>
        <body>
          <div class="card">
            <h1>❌ Payment Failed</h1>
            <p>Please try again.</p>
            <a href="/" class="btn">Try Again</a>
          </div>
        </body>
        </html>
      `);
    }
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).send("Verification failed");
  }
});

// ================= PAYMENT: Webhook =================
app.post("/paystack-webhook", express.json(), async (req, res) => {
  const event = req.body;
  if (event.event === 'charge.success') {
    const data = event.data;
    const userId = data.metadata.userId;
    try {
      await db.query(
        `UPDATE subscriptions 
         SET status = 'active', 
             subscriptionEndDate = NOW() + INTERVAL '30 days',
             planType = 'premium'
         WHERE userId = $1`,
        [userId]
      );
      console.log(`✅ Webhook: Subscription activated for ${userId}`);
    } catch (err) {
      console.error("Webhook error:", err);
    }
  }
  res.sendStatus(200);
});

// ================= START =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("✅ Leago AI Tutor running on port " + PORT);
  console.log("💰 Pricing: SA HS R49.99 | SA College R199.99 | Intl HS R149.99 | Intl College R299.99");
  console.log("🧠 Conversational AI tutor is ready!");
});