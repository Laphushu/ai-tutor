// server/db.js – PostgreSQL with automatic column addition
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    // ---- Create tables if not exist ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        code VARCHAR(10) UNIQUE NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS provinces (
        id SERIAL PRIMARY KEY,
        country_id INTEGER REFERENCES countries(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        UNIQUE(country_id, name)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS education_levels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        sort_order INTEGER DEFAULT 0
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS curricula (
        id SERIAL PRIMARY KEY,
        country_id INTEGER REFERENCES countries(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        UNIQUE(country_id, name)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS grades (
        id SERIAL PRIMARY KEY,
        education_level_id INTEGER REFERENCES education_levels(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        display_name VARCHAR(50) NOT NULL,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(education_level_id, name)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        curriculum_id INTEGER REFERENCES curricula(id) ON DELETE CASCADE,
        grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        UNIQUE(curriculum_id, grade_id, name)
      );
    `);
    await client.query(`
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
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ---- Add missing columns if needed ----
    // 1. subjects column
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subjects') THEN
          ALTER TABLE users ADD COLUMN subjects JSONB DEFAULT '[]'::jsonb;
        END IF;
      END $$;
    `);

    // 2. province_id column (if missing)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='province_id') THEN
          ALTER TABLE users ADD COLUMN province_id INTEGER REFERENCES provinces(id);
        END IF;
      END $$;
    `);

    // ---- Create remaining tables ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'trial',
        start_date TIMESTAMP DEFAULT NOW(),
        end_date TIMESTAMP DEFAULT NOW() + INTERVAL '3 days'
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        topic_name VARCHAR(255),
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, subject_id, topic_name)
      );
    `);
    await client.query(`
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

    // ---- Seed default data (countries, provinces, curricula, grades, subjects) ----
    // (same as before – you already have it in your current db.js)
    // ... keep your seeding code here ...

    console.log('✅ Database tables and default data ready (PostgreSQL)');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };