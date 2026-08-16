const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/auth');
const crypto = require('crypto');

// ===== POST /api/payments/create =====
// Securely initialise a Paystack transaction.
router.post('/create', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // from JWT, never trust body

  // Fetch user email from database
  const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
  if (userRes.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const email = userRes.rows[0].email;

  try {
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        amount: 4999, // ZAR 49.99 in cents
        currency: 'ZAR',
        callback_url: 'https://leagoacademy.co.za/dashboard', // adjust to your live domain if different
        metadata: { user_id: userId }
      })
    });
    const data = await paystackResponse.json();
    if (!data.status) {
      throw new Error(data.message || 'Paystack initialization failed');
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

// ===== POST /api/payments/webhook =====
// Idempotent webhook handler.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
  if (hash !== signature) {
    return res.status(401).send('Unauthorized');
  }

  const event = req.body;
  if (event.event === 'charge.success') {
    const userId = event.data.metadata.user_id;
    const transactionRef = event.data.reference;

    try {
      // Begin transaction
      await pool.query('BEGIN');

      // 1. Update or insert subscription
      await pool.query(
        `INSERT INTO subscriptions (user_id, plan, status, start_date, expires_at, transaction_ref)
         VALUES ($1, 'premium', 'active', NOW(), NOW() + INTERVAL '1 month', $2)
         ON CONFLICT (user_id) DO UPDATE
         SET plan = 'premium',
             status = 'active',
             start_date = NOW(),
             expires_at = NOW() + INTERVAL '1 month',
             transaction_ref = $2,
             updated_at = NOW()`,
        [userId, transactionRef]
      );

      // 2. Update users.plan for immediate effect
      await pool.query(
        `UPDATE users SET plan = 'premium', updated_at = NOW() WHERE id = $1`,
        [userId]
      );

      await pool.query('COMMIT');
      console.log(`✅ User ${userId} upgraded to premium (ref: ${transactionRef})`);
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error('Webhook DB error:', err);
      return res.status(500).send('DB error');
    }
  }
  res.sendStatus(200);
});

module.exports = router;