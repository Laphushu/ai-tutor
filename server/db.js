const { Pool } = require('pg');

const isLocalhost = process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalhost ? false : { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create tables (if not exist)
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

      -- Add missing columns if they don't exist
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS icon VARCHAR(50);
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS color VARCHAR(20);
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS description TEXT;

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

    // Additional user column migrations
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_question_count INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_question_date DATE;
    `);

    // Seed subjects if empty (kept as-is, idempotent)
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

    // ========== SEED LOOKUP TABLES ==========
    // All inserts use ON CONFLICT DO NOTHING to be idempotent.

    // 1. Countries
    await client.query(`
      INSERT INTO countries (name, code) VALUES
      ('South Africa', 'ZA'),
      ('Kenya', 'KE'),
      ('Nigeria', 'NG'),
      ('Zimbabwe', 'ZW'),
      ('Botswana', 'BW'),
      ('Ghana', 'GH')
      ON CONFLICT (code) DO NOTHING
    `);

    // 2. Provinces – South Africa (9 provinces)
    await client.query(`
      INSERT INTO provinces (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'ZA'), 'Eastern Cape'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'Free State'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'Gauteng'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'KwaZulu-Natal'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'Limpopo'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'Mpumalanga'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'Northern Cape'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'North West'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'Western Cape')
      ON CONFLICT (country_id, name) DO NOTHING
    `);

    // 3. Provinces – Kenya
    await client.query(`
      INSERT INTO provinces (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'KE'), 'Nairobi'),
      ((SELECT id FROM countries WHERE code = 'KE'), 'Mombasa'),
      ((SELECT id FROM countries WHERE code = 'KE'), 'Kisumu')
      ON CONFLICT (country_id, name) DO NOTHING
    `);

    // 4. Provinces – Nigeria (major states)
    await client.query(`
      INSERT INTO provinces (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'NG'), 'Lagos'),
      ((SELECT id FROM countries WHERE code = 'NG'), 'Abuja'),
      ((SELECT id FROM countries WHERE code = 'NG'), 'Kano'),
      ((SELECT id FROM countries WHERE code = 'NG'), 'Ibadan')
      ON CONFLICT (country_id, name) DO NOTHING
    `);

    // 5. Provinces – Zimbabwe
    await client.query(`
      INSERT INTO provinces (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'ZW'), 'Harare'),
      ((SELECT id FROM countries WHERE code = 'ZW'), 'Bulawayo'),
      ((SELECT id FROM countries WHERE code = 'ZW'), 'Manicaland')
      ON CONFLICT (country_id, name) DO NOTHING
    `);

    // 6. Provinces – Botswana
    await client.query(`
      INSERT INTO provinces (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'BW'), 'Gaborone'),
      ((SELECT id FROM countries WHERE code = 'BW'), 'Francistown'),
      ((SELECT id FROM countries WHERE code = 'BW'), 'Central District')
      ON CONFLICT (country_id, name) DO NOTHING
    `);

    // 7. Provinces – Ghana
    await client.query(`
      INSERT INTO provinces (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'GH'), 'Greater Accra'),
      ((SELECT id FROM countries WHERE code = 'GH'), 'Ashanti'),
      ((SELECT id FROM countries WHERE code = 'GH'), 'Central')
      ON CONFLICT (country_id, name) DO NOTHING
    `);

    // 8. Education levels
    await client.query(`
      INSERT INTO education_levels (name, sort_order) VALUES
      ('High School', 1),
      ('TVET College', 2),
      ('University', 3),
      ('Other', 4)
      ON CONFLICT (name) DO NOTHING
    `);

    // 9. Curricula – mapped to countries
    await client.query(`
      INSERT INTO curricula (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'ZA'), 'CAPS'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'IEB'),
      ((SELECT id FROM countries WHERE code = 'KE'), 'CBC'),
      ((SELECT id FROM countries WHERE code = 'NG'), 'WAEC'),
      ((SELECT id FROM countries WHERE code = 'ZW'), 'ZIMSEC')
      ON CONFLICT (country_id, name) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✅ Database tables and schema migrations initialized');
    console.log('✅ Lookup data seeded (countries, provinces, education levels, curricula)');
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