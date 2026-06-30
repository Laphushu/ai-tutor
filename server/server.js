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

const app = express();

// ================= RESEND (optional) =================
let resend = null;
try {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log("✅ Resend email service initialized");
  } else {
    console.warn("⚠️ RESEND_API_KEY not set. Emails disabled.");
  }
} catch (err) {
  console.warn("⚠️ Resend disabled:", err.message);
}

app.use(cors());
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= INIT TABLES (with curriculum fields) =================
async function initDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        name TEXT,
        country TEXT,
        province TEXT,
        curriculum TEXT,
        grade TEXT,
        school TEXT,
        subjects TEXT[],
        role TEXT DEFAULT 'learner',
        is_admin BOOLEAN DEFAULT false,
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
    console.log("✅ Database ready with curriculum fields");
  } catch (err) {
    console.error("❌ DB init error:", err.message);
  }
}
initDB();

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
});

async function ensureTrial(userId) {
  try {
    await db.query(
      `INSERT INTO subscriptions (userId, status) VALUES ($1, 'trial') ON CONFLICT (userId) DO NOTHING`,
      [userId]
    );
  } catch (err) { console.error("Trial error:", err.message); }
}

async function sendEmail(to, subject, html) {
  if (!resend) { console.log("📧 Email disabled (would send to)", to); return true; }
  try {
    const { error } = await resend.emails.send({
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

// ================= CURRICULUM DATA =================
const CURRICULUM_DATA = {
  'South Africa': {
    curricula: ['CAPS', 'IEB', 'Cambridge'],
    grades: ['10', '11', '12', 'College'],
    subjects: {
      'CAPS': {
        '10': ['Mathematics', 'English', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Life Orientation', 'Technology', 'Visual Arts', 'Dramatic Arts', 'Music'],
        '11': ['Mathematics', 'English', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Life Orientation', 'Technology', 'Visual Arts', 'Dramatic Arts', 'Music'],
        '12': ['Mathematics', 'English', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Life Orientation', 'Technology', 'Visual Arts', 'Dramatic Arts', 'Music'],
        'College': ['Engineering', 'Computer Science', 'Business & Management', 'Health Sciences', 'Law', 'Education', 'Arts & Humanities', 'Accounting', 'Economics', 'Psychology']
      },
      'IEB': {
        '10': ['Mathematics', 'English', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Life Orientation'],
        '11': ['Mathematics', 'English', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Life Orientation'],
        '12': ['Mathematics', 'English', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Life Orientation'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education', 'Arts']
      },
      'Cambridge': {
        '10': ['Mathematics', 'English', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics'],
        '11': ['Mathematics', 'English', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics'],
        '12': ['Mathematics', 'English', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Arts']
      }
    }
  },
  'Kenya': {
    curricula: ['CBC', '8-4-4'],
    grades: ['7', '8', '9', '10', '11', '12', 'College'],
    subjects: {
      'CBC': {
        '7': ['English', 'Kiswahili', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Agriculture', 'Home Science', 'Computer Studies', 'Creative Arts', 'Physical Education'],
        '8': ['English', 'Kiswahili', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Agriculture', 'Home Science', 'Computer Studies', 'Creative Arts', 'Physical Education'],
        '9': ['English', 'Kiswahili', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Agriculture', 'Home Science', 'Computer Studies', 'Creative Arts', 'Physical Education'],
        '10': ['English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Business Studies', 'Religious Education', 'Computer Studies'],
        '11': ['English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Business Studies', 'Religious Education', 'Computer Studies'],
        '12': ['English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Business Studies', 'Religious Education', 'Computer Studies'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education', 'Agriculture']
      },
      '8-4-4': {
        '7': ['English', 'Kiswahili', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Agriculture', 'Home Science', 'Computer Studies'],
        '8': ['English', 'Kiswahili', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Agriculture', 'Home Science', 'Computer Studies'],
        '9': ['English', 'Kiswahili', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Agriculture', 'Home Science', 'Computer Studies'],
        '10': ['English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Education', 'Business Studies'],
        '11': ['English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Education', 'Business Studies'],
        '12': ['English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Education', 'Business Studies'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education']
      }
    }
  },
  'Nigeria': {
    curricula: ['WAEC', 'NECO'],
    grades: ['7', '8', '9', '10', '11', '12', 'College'],
    subjects: {
      'WAEC': {
        '7': ['English', 'Mathematics', 'Basic Science', 'Social Studies', 'Religious Studies', 'Yoruba/Hausa/Igbo', 'Agricultural Science', 'Home Economics', 'Creative Arts', 'Physical Education'],
        '8': ['English', 'Mathematics', 'Basic Science', 'Social Studies', 'Religious Studies', 'Yoruba/Hausa/Igbo', 'Agricultural Science', 'Home Economics', 'Creative Arts', 'Physical Education'],
        '9': ['English', 'Mathematics', 'Basic Science', 'Social Studies', 'Religious Studies', 'Yoruba/Hausa/Igbo', 'Agricultural Science', 'Home Economics', 'Creative Arts', 'Physical Education'],
        '10': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Yoruba/Hausa/Igbo', 'Civic Education', 'Agricultural Science', 'Economics', 'Literature in English'],
        '11': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Yoruba/Hausa/Igbo', 'Civic Education', 'Agricultural Science', 'Economics', 'Literature in English'],
        '12': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Yoruba/Hausa/Igbo', 'Civic Education', 'Agricultural Science', 'Economics', 'Literature in English'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education', 'Agriculture', 'Medicine']
      },
      'NECO': {
        '10': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Civic Education', 'Yoruba/Hausa/Igbo', 'Agricultural Science', 'Economics'],
        '11': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Civic Education', 'Yoruba/Hausa/Igbo', 'Agricultural Science', 'Economics'],
        '12': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Civic Education', 'Yoruba/Hausa/Igbo', 'Agricultural Science', 'Economics'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education']
      }
    }
  },
  'Zimbabwe': {
    curricula: ['ZIMSEC'],
    grades: ['10', '11', '12', '13', 'College'],
    subjects: {
      'ZIMSEC': {
        '10': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Shona/Ndebele', 'Religious Education', 'Agriculture'],
        '11': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Shona/Ndebele', 'Religious Education', 'Agriculture'],
        '12': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Shona/Ndebele', 'Religious Education', 'Agriculture'],
        '13': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Shona/Ndebele', 'Religious Education', 'Agriculture'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education', 'Agriculture']
      }
    }
  },
  'Botswana': {
    curricula: ['BGCSE'],
    grades: ['10', '11', '12', '13', 'College'],
    subjects: {
      'BGCSE': {
        '10': ['English', 'Setswana', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Education', 'Agriculture'],
        '11': ['English', 'Setswana', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Education', 'Agriculture'],
        '12': ['English', 'Setswana', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Education', 'Agriculture'],
        '13': ['English', 'Setswana', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Education', 'Agriculture'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education']
      }
    }
  },
  'Namibia': {
    curricula: ['NSSCO', 'NSSCAS', 'Cambridge'],
    grades: ['10', '11', '12', '13', 'College'],
    subjects: {
      'NSSCO': {
        '10': ['English', 'Afrikaans', 'Oshiwambo', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies'],
        '11': ['English', 'Afrikaans', 'Oshiwambo', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies'],
        '12': ['English', 'Afrikaans', 'Oshiwambo', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies'],
        '13': ['English', 'Afrikaans', 'Oshiwambo', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education']
      },
      'NSSCAS': {
        '12': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Accounting'],
        '13': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious Studies', 'Accounting'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education']
      }
    }
  },
  'Ghana': {
    curricula: ['WAEC'],
    grades: ['7', '8', '9', '10', '11', '12', 'College'],
    subjects: {
      'WAEC': {
        '7': ['English', 'Mathematics', 'Science', 'Social Studies', 'Religious & Moral Education', 'Ghanaian Language', 'Creative Arts', 'Physical Education', 'ICT'],
        '8': ['English', 'Mathematics', 'Science', 'Social Studies', 'Religious & Moral Education', 'Ghanaian Language', 'Creative Arts', 'Physical Education', 'ICT'],
        '9': ['English', 'Mathematics', 'Science', 'Social Studies', 'Religious & Moral Education', 'Ghanaian Language', 'Creative Arts', 'Physical Education', 'ICT'],
        '10': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious & Moral Education', 'Ghanaian Language', 'Economics', 'Accounting'],
        '11': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious & Moral Education', 'Ghanaian Language', 'Economics', 'Accounting'],
        '12': ['English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Religious & Moral Education', 'Ghanaian Language', 'Economics', 'Accounting'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education']
      }
    }
  },
  'Egypt': {
    curricula: ['Thanaweya Amma', 'IGCSE', 'American'],
    grades: ['10', '11', '12', 'College'],
    subjects: {
      'Thanaweya Amma': {
        '10': ['Arabic', 'English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Philosophy', 'Religious Studies'],
        '11': ['Arabic', 'English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Philosophy', 'Religious Studies'],
        '12': ['Arabic', 'English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Philosophy', 'Religious Studies'],
        'College': ['Engineering', 'Computer Science', 'Business', 'Health Sciences', 'Law', 'Education']
      }
    }
  }
};

// ================= GET CURRICULUM DATA =================
app.get("/api/curriculum/:country", async (req, res) => {
  const { country } = req.params;
  const data = CURRICULUM_DATA[country];
  if (!data) {
    return res.status(404).json({ error: "Country not found" });
  }
  res.json({
    curricula: data.curricula,
    grades: data.grades,
    subjects: data.subjects
  });
});

// ================= AUTH: SIGNUP (with curriculum fields) =================
app.post("/signup", async (req, res) => {
  const { email, password, name, country, province, curriculum, grade, school, subjects, role } = req.body;
  if (!email || !password || !name || !country) return res.status(400).json({ error: "All fields required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const existing = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: "Email already registered" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const userId = 'user_' + email.replace(/[^a-zA-Z0-9]/g, '_');

    await db.query(
      `INSERT INTO users (userId, email, password, name, country, province, curriculum, grade, school, subjects, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [userId, email, hashedPassword, name, country, province || '', curriculum || '', grade || '', school || '', subjects || [], role || 'learner']
    );
    await ensureTrial(userId);

    await sendEmail(
      email,
      '🎉 Welcome to Leago Academy!',
      `<h1>Welcome ${name}!</h1><p>Your AI tutor is ready.</p><p>You have a <strong>3-day free trial</strong>.</p><a href="https://synapses-uwh1.onrender.com" style="background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Start Learning →</a>`
    );
    res.json({ success: true, user: { id: userId, email, name, country, role: role || 'learner' } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ================= AUTH: LOGIN =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const result = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const user = result.rows[0];

    let passwordMatch = false;
    if (user.password.startsWith('$2')) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      passwordMatch = (password === user.password);
      if (passwordMatch) {
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(password, salt);
        await db.query(`UPDATE users SET password = $1 WHERE userId = $2`, [hashed, user.userid]);
        console.log(`✅ Password upgraded for ${email}`);
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.userid, email: user.email },
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
        province: user.province,
        curriculum: user.curriculum,
        grade: user.grade,
        school: user.school,
        subjects: user.subjects,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ================= UPDATE USER PROFILE =================
app.post("/save-profile", async (req, res) => {
  const { userId, name, country, province, curriculum, grade, school, subjects } = req.body;
  try {
    await db.query(
      `UPDATE users SET 
        name = $1, 
        country = $2, 
        province = $3, 
        curriculum = $4, 
        grade = $5, 
        school = $6, 
        subjects = $7 
       WHERE userId = $8`,
      [name, country, province || '', curriculum || '', grade || '', school || '', subjects || [], userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= CHAT (Curriculum-Aware AI Prompt) =================
app.post("/chat", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ reply: "Missing userId or message" });

  try {
    await ensureTrial(userId);
    const userResult = await db.query(`SELECT * FROM users WHERE userId = $1`, [userId]);
    const user = userResult.rows[0];
    if (!user) return res.json({ reply: "Please create your profile first." });

    const subResult = await db.query(`SELECT * FROM subscriptions WHERE userId = $1`, [userId]);
    const sub = subResult.rows[0];
    if (!sub) return res.json({ reply: "Subscription error." });

    const trialDays = 3;
    const start = new Date(sub.startdate || sub.startDate);
    const now = new Date();
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    let isActive = false;
    if (sub.status === 'active' && sub.subscriptionenddate) {
      const endDate = new Date(sub.subscriptionenddate);
      if (now < endDate) isActive = true;
    }
    if (sub.status === 'trial' && diffDays > trialDays && !isActive) {
      return res.json({ reply: "Your 3-day free trial has ended. Please subscribe." });
    }
    if (sub.status === 'expired') return res.json({ reply: "Your subscription has expired. Please renew." });

    const messagesResult = await db.query(
      `SELECT role, content FROM messages WHERE userId = $1 ORDER BY id DESC LIMIT 10`,
      [userId]
    );

    // Build curriculum-aware system prompt
    const curriculumContext = user.curriculum ? `Curriculum: ${user.curriculum}` : '';
    const gradeContext = user.grade ? `Grade: ${user.grade}` : '';
    const countryContext = user.country ? `Country: ${user.country}` : '';
    const provinceContext = user.province ? `Province: ${user.province}` : '';
    const subjectsContext = user.subjects && user.subjects.length > 0 ? `Subjects: ${user.subjects.join(', ')}` : '';

    const systemPrompt = `
You are Leago, a warm, patient, and encouraging AI tutor designed specifically for African students.

STUDENT CONTEXT:
Country: ${countryContext}
Province: ${provinceContext}
Curriculum: ${curriculumContext}
Grade: ${gradeContext}
Subjects: ${subjectsContext}
Student Name: ${user.name}

IMPORTANT RULES:
1. ALWAYS teach according to the student's curriculum (${user.curriculum || 'CAPS'}) and grade level.
2. START WITH QUESTIONS, NOT LECTURES.
3. ONE QUESTION AT A TIME.
4. Explain concepts clearly with examples relevant to the student's country and context.
5. Define new terms.
6. Show 2-3 worked examples.
7. Check understanding: "Do you understand? Shall I explain again?"
8. Be encouraging: "That's a good try! Let me explain it another way..."
9. When the student demonstrates understanding, ask them to explain the concept in their own words.
10. Use examples and references that are familiar to African students (local context, culture, everyday life).

Remember: You are Leago, Africa's AI learning assistant. Make the student feel confident and supported.
`;

    const history = [{ role: "system", content: systemPrompt }];
    const reversed = messagesResult.rows.reverse();
    for (const m of reversed) history.push({ role: m.role, content: m.content });
    history.push({ role: "user", content: message });

    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: history,
      temperature: 0.7,
      max_tokens: 1000
    });
    const reply = response.choices[0].message.content;

    await db.query(`INSERT INTO messages (userId, role, content) VALUES ($1, $2, $3)`, [userId, "user", message]);
    await db.query(`INSERT INTO messages (userId, role, content) VALUES ($1, $2, $3)`, [userId, "assistant", reply]);

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
    if (result.rows.length === 0) return res.json({ status: 'trial', daysRemaining: 3, planType: 'free' });
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
  if (!userId || !email) return res.status(400).json({ error: "Missing userId or email" });

  try {
    const userResult = await db.query(`SELECT name, country, grade FROM users WHERE userId = $1`, [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    let amount = 14999, priceDisplay = 'R149.99';
    const isCollege = (user.grade === 'College' || user.grade === 'Tertiary' || user.grade === 'College');
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
  if (!reference) return res.status(400).send("Missing reference");

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("✅ Leago AI Tutor running on port " + PORT);
  console.log("💳 Payments enabled");
  console.log("🌍 Africa Education Engine active");
});