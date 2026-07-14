const { pool } = require('../db');

module.exports = async (req, res, next) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0 || !result.rows[0].is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};