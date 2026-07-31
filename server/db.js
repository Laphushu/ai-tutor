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

      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topics (
        id SERIAL PRIMARY KEY,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        curriculum_id INTEGER REFERENCES curricula(id),
        grade VARCHAR(20),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        order_number INTEGER DEFAULT 0,
        UNIQUE(subject_id, title)
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
        grade VARCHAR(20),
        role VARCHAR(20) DEFAULT 'learner',
        plan VARCHAR(20) DEFAULT 'free',
        daily_question_count INTEGER DEFAULT 0,
        last_question_date DATE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_subjects (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        UNIQUE(user_id, subject_id)
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plan VARCHAR(20) DEFAULT 'free',
        status VARCHAR(20) DEFAULT 'active',
        start_date TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP,
        transaction_ref VARCHAR(100),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id),
        topic_id INTEGER REFERENCES topics(id),
        title VARCHAR(255) DEFAULT 'New Conversation',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR(10) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS student_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id),
        topic_id INTEGER REFERENCES topics(id),
        status VARCHAR(20) DEFAULT 'not_started',
        completion_percentage INTEGER DEFAULT 0,
        last_opened TIMESTAMP DEFAULT NOW(),
        time_spent INTEGER DEFAULT 0,
        questions_answered INTEGER DEFAULT 0,
        correct_answers INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, topic_id)
      );

      CREATE TABLE IF NOT EXISTS uploads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
        type VARCHAR(20) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        file_url TEXT NOT NULL,
        file_size INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. Add missing columns to subjects table (if not exist)
    await client.query(`
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS icon VARCHAR(50);
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS color VARCHAR(20);
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS description TEXT;
    `);

    // 3. Dynamic Column Migrations for users
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_question_count INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_question_date DATE;
    `);

    // 4. Seed subjects if empty
    const subjectsCheck = await client.query('SELECT COUNT(*) FROM subjects');
    if (parseInt(subjectsCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO subjects (name, icon, color, description) VALUES
        ('Mathematics', '📐', '#7C3AED', 'Numbers, algebra, calculus, and beyond'),
        ('Physical Sciences', '⚛️', '#3B82F6', 'Physics and chemistry fundamentals'),
        ('Life Sciences', '🧬', '#10B981', 'Biology, genetics, and ecology'),
        ('Accounting', '💰', '#F59E0B', 'Financial and managerial accounting'),
        ('English', '📖', '#EF4444', 'Language, literature, and writing'),
        ('Geography', '🌍', '#06B6D4', 'Physical and human geography'),
        ('History', '🏛️', '#8B5CF6', 'African and world history'),
        ('Information Technology', '💻', '#6366F1', 'Programming, networks, and cybersecurity'),
        ('Business Studies', '📊', '#F97316', 'Entrepreneurship, marketing, and finance'),
        ('Economics', '📈', '#14B8A6', 'Micro and macroeconomics')
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Database tables and schema migrations initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DATABASE ERROR');
    console.error(err);
    console.error(err.stack);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };