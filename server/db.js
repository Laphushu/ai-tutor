// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      country_id INTEGER,
      province VARCHAR(100),
      education_level_id INTEGER,
      curriculum_id INTEGER,
      grade_id INTEGER,
      role VARCHAR(20) DEFAULT 'learner',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) DEFAULT 'trial',
      start_date TIMESTAMP DEFAULT NOW(),
      end_date TIMESTAMP DEFAULT NOW() + INTERVAL '3 days'
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS progress (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subject_name VARCHAR(100),
      topic_name VARCHAR(255),
      completed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, subject_name, topic_name)
    );
  `);
  console.log('✅ Database tables ready');
}

module.exports = { pool, initDB };