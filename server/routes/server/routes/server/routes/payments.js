// server/routes/payments.js
const express = require('express');
const { pool } = require('../db');
const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

router.post('/create', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing fields' });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Paystack not configured' });
  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount: 4999,
        currency: 'ZAR',
        callback_url: process.env.PAYSTACK_CALLBACK_URL || 'https://leagoacademy.co.za/success',
        metadata: { userId }
      })
    });
    const data = await response.json();
    if (!data.status) return res.status(400).json({ error: data.message });
    res.json({ authorization_url: data.data.authorization_url });
  } catch (e) {
    console.error('Payment error:', e.message);
    res.status(500).json({ error: 'Payment error' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = req.body;
  if (event.event === 'charge.success') {
    const userId = event.data.metadata?.userId;
    if (userId) {
      try {
        await pool.query(
          `INSERT INTO subscriptions (user_id, status, start_date, end_date)
           VALUES ($1, 'active', NOW(), NOW() + INTERVAL '30 days')
           ON CONFLICT (user_id) DO UPDATE SET status = 'active', start_date = NOW(), end_date = NOW() + INTERVAL '30 days'`,
          [userId]
        );
        console.log(`✅ Subscription activated for user ${userId}`);
      } catch (err) {
        console.error('Webhook error:', err.message);
      }
    }
  }
  res.sendStatus(200);
});

router.get('/success', (req, res) => {
  res.send('<h1>Payment successful</h1><a href="/">Go back</a>');
});

module.exports = router;