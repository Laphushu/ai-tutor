const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.post('/create', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });
  try {
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': Bearer ,
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
    if (!data.status) throw new Error(data.message || 'Paystack error');
    res.json({ authorization_url: data.data.authorization_url, reference: data.data.reference });
  } catch(err) {
    console.error('Payment init error:', err);
    res.status(500).json({ error: 'Payment service unavailable' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const crypto = require('crypto');
  const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
  if (hash !== signature) return res.status(401).send('Unauthorized');
  const event = req.body;
  if (event.event === 'charge.success') {
    const userId = event.data.metadata.user_id;
    const transactionRef = event.data.reference;
    try {
      await pool.query(
        INSERT INTO subscriptions (user_id, plan, remaining_questions, expires_at, transaction_ref)
         VALUES (, 'premium', -1, NOW() + INTERVAL '1 month', )
         ON CONFLICT (user_id) DO UPDATE
         SET plan = 'premium', remaining_questions = -1, expires_at = NOW() + INTERVAL '1 month',
             transaction_ref = , updated_at = NOW(),
        [userId, transactionRef]
      );
      console.log(✅ User  upgraded to premium);
    } catch(err) {
      console.error('Webhook DB error:', err);
      return res.status(500).send('DB error');
    }
  }
  res.sendStatus(200);
});

module.exports = router;
