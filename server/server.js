// ================================================================
//  SERVER – Leago Academy
//  Complete file with all routes
// ================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

// ===== DATABASE CONNECTION =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ================================================================
//  AUTH ROUTES
// ================================================================

// ---------- SIGNUP ----------
app.post('/api/auth/signup', async (req, res) => {
    const {
        firstName, lastName, email, password,
        countryId, province, educationLevelId, grade,
        curriculumId, subjects, role = 'learner'
    } = req.body;

    if (!firstName || !lastName || !email || !password || !countryId || !educationLevelId || !grade || !curriculumId || !subjects) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const result = await pool.query(
            `INSERT INTO users 
            (first_name, last_name, email, password_hash, country_id, province, education_level_id, grade, curriculum_id, subjects, role) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
            RETURNING id, first_name, last_name, email, role, grade, subjects`,
            [firstName, lastName, email, password, countryId, province, educationLevelId, grade, curriculumId, subjects, role]
        );

        res.status(201).json({
            success: true,
            user: result.rows[0]
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ---------- LOGIN ----------
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    try {
        const result = await pool.query(
            `SELECT id, first_name, last_name, email, role, grade, subjects, country_id, province, education_level_id, curriculum_id,
                (SELECT name FROM countries WHERE id = users.country_id) AS country_name,
                (SELECT name FROM curricula WHERE id = users.curriculum_id) AS curriculum_name,
                (SELECT name FROM education_levels WHERE id = users.education_level_id) AS education_level_name,
                grade AS grade_name
            FROM users WHERE email = $1 AND password_hash = $2`,
            [email, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        if (typeof user.subjects === 'string') {
            user.subjects = JSON.parse(user.subjects);
        }

        res.json({ success: true, user });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ---------- SUBSCRIPTION STATUS ----------
app.get('/api/auth/subscription/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT plan, remaining_questions, expires_at 
             FROM subscriptions WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) 
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );
        if (result.rows.length === 0) {
            return res.json({ plan: 'free', remainingQuestions: 10 });
        }
        const sub = result.rows[0];
        res.json({
            plan: sub.plan,
            remainingQuestions: sub.remaining_questions,
            expiresAt: sub.expires_at
        });
    } catch (err) {
        console.error('Subscription error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ================================================================
//  CHAT ROUTE (with max_tokens=2048 and improved prompt)
// ================================================================
app.post('/api/chat', async (req, res) => {
    const { userId, message, subject, topic } = req.body;
    if (!userId || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const subResult = await pool.query(
            `SELECT plan, remaining_questions FROM subscriptions 
             WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) 
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );
        let plan = 'free';
        let remaining = 10;
        if (subResult.rows.length > 0) {
            plan = subResult.rows[0].plan;
            remaining = subResult.rows[0].remaining_questions;
        }

        if (plan === 'free' && remaining <= 0) {
            return res.status(403).json({ error: 'limit_reached' });
        }

        const prompt = `You are an AI tutor for Leago Academy. The student is learning ${subject} (topic: ${topic}). 
Provide a clear, step-by-step explanation. 
Use LaTeX notation for math. For inline math, use single dollar signs like $f(x)=x^2$. 
For displayed equations, use double dollar signs like $$\\lim_{h\\to0} \\frac{f(x+h)-f(x)}{h}$$. 
Use \\boxed{} only inside math delimiters. Never use \\[ or \\] – use $$ instead. 
Be encouraging and thorough.`;

        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: message }
                ],
                max_tokens: 2048,
                temperature: 0.7,
                stream: false
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('DeepSeek error:', data);
            throw new Error(data.error?.message || 'AI service error');
        }

        const reply = data.choices[0].message.content;

        if (plan === 'free') {
            await pool.query(
                `UPDATE subscriptions SET remaining_questions = remaining_questions - 1 
                 WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) 
                 ORDER BY created_at DESC LIMIT 1`,
                [userId]
            );
        }

        res.json({ reply });
    } catch (err) {
        console.error('Chat error:', err);
        res.status(500).json({ error: 'Failed to get AI response' });
    }
});

// ================================================================
//  PAYSTACK PAYMENT ROUTES
// ================================================================

// ---------- CREATE PAYMENT ----------
app.post('/api/payments/create', async (req, res) => {
    const { userId, email } = req.body;
    if (!userId || !email) {
        return res.status(400).json({ error: 'Missing userId or email' });
    }

    try {
        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                amount: 4999,
                currency: 'ZAR',
                callback_url: 'https://leagoacademy.co.za/dashboard',
                metadata: { user_id: userId }
            })
        });

        const data = await paystackResponse.json();
        if (!data.status) {
            throw new Error(data.message || 'Paystack error');
        }

        res.json({
            authorization_url: data.data.authorization_url,
            reference: data.data.reference
        });
    } catch (err) {
        console.error('Payment init error:', err);
        res.status(500).json({ error: 'Payment service unavailable' });
    }
});

// ---------- PAYSTACK WEBHOOK ----------
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    const secret = process.env.PAYSTACK_SECRET_KEY;

    const crypto = require('crypto');
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
    if (hash !== signature) {
        return res.status(401).send('Unauthorized');
    }

    const event = req.body;
    if (event.event === 'charge.success') {
        const metadata = event.data.metadata;
        const userId = metadata.user_id;
        const transactionRef = event.data.reference;

        try {
            await pool.query(
                `INSERT INTO subscriptions (user_id, plan, remaining_questions, expires_at, transaction_ref) 
                 VALUES ($1, 'premium', -1, NOW() + INTERVAL '1 month', $2)
                 ON CONFLICT (user_id) DO UPDATE 
                 SET plan = 'premium', remaining_questions = -1, expires_at = NOW() + INTERVAL '1 month', 
                     transaction_ref = $2, updated_at = NOW()`,
                [userId, transactionRef]
            );
            console.log(`✅ User ${userId} upgraded to premium`);
        } catch (err) {
            console.error('Webhook DB error:', err);
            return res.status(500).send('DB error');
        }
    }

    res.sendStatus(200);
});

// ================================================================
//  START SERVER
// ================================================================
app.listen(port, () => {
    console.log(`🚀 Leago Academy server running on port ${port}`);
});