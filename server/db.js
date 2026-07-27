const { Pool } = require('pg');

// Automatically detect if running against localhost or a cloud database
const isLocalhost = process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalhost ? false : { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Core Lookup & User Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        code VARCHAR(10) UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provinces (
        id SERIAL PRIMARY KEY,
        country_id INTEGER REFERENCES countries(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        UNIQUE(country_id, name)
      );

      CREATE TABLE IF NOT EXISTS education_levels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS curricula (
        id SERIAL PRIMARY KEY,
        country_id INTEGER REFERENCES countries(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        UNIQUE(country_id, name)
      );

      CREATE TABLE IF NOT EXISTS grades (
        id SERIAL PRIMARY KEY,
        education_level_id INTEGER REFERENCES education_levels(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        display_name VARCHAR(50) NOT NULL,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(education_level_id, name)
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        curriculum_id INTEGER REFERENCES curricula(id) ON DELETE CASCADE,
        grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        UNIQUE(curriculum_id, grade_id, name)
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        country_id INTEGER REFERENCES countries(id),
        province_id INTEGER REFERENCES provinces(id),
        education_level_id INTEGER REFERENCES education_levels(id),
        curriculum_id INTEGER REFERENCES curricula(id),
        grade_id INTEGER REFERENCES grades(id),
        role VARCHAR(20) DEFAULT 'learner',
        subjects JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. Dynamic Column Migrations (Clean, Native Postgres Syntax)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_question_count INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_question_date DATE;
    `);

    // 3. Activity & Subscription Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'free',
        start_date TIMESTAMP DEFAULT NOW(),
        end_date TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        topic_name VARCHAR(255),
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, subject_id, topic_name)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reference VARCHAR(100) UNIQUE,
        amount INTEGER,
        currency VARCHAR(10),
        status VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('✅ Database tables and schema migrations initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DB init error:', err.message);
    throw err; // Propagate error so server startup aborts cleanly if DB fails
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };