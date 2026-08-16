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

    // ===== CREATE TABLES =====
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

    // ===== STAGE 2: CURRICULUM-SUBJECT ARCHITECTURE =====

    // 1. Safety: Check for duplicate subject names before adding UNIQUE constraint
    await client.query(`
      DO $$
      DECLARE
        dup_count INTEGER;
      BEGIN
        SELECT COUNT(*) INTO dup_count FROM (
          SELECT name, COUNT(*) FROM subjects GROUP BY name HAVING COUNT(*) > 1
        ) AS duplicates;

        IF dup_count > 0 THEN
          RAISE EXCEPTION 'Duplicate subject names found. Please resolve duplicates before adding UNIQUE constraint.';
        END IF;
      END $$;
    `);

    // 2. Add unique constraint on subjects.name
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'subjects_name_key'
        ) THEN
          ALTER TABLE subjects ADD CONSTRAINT subjects_name_key UNIQUE (name);
        END IF;
      END $$;
    `);

    // 3. Create curriculum_subjects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS curriculum_subjects (
        id SERIAL PRIMARY KEY,
        curriculum_id INTEGER REFERENCES curricula(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        UNIQUE(curriculum_id, subject_id)
      );
    `);

    // 4. Seed/expand subjects (existing subjects kept, new ones added)
    await client.query(`
      INSERT INTO subjects (name, icon, color, description) VALUES
      -- Existing subjects (keep IDs unchanged)
      ('Mathematics', '📐', '#7C3AED', 'Pure Mathematics – algebra, calculus, geometry'),
      ('Physical Sciences', '⚛️', '#3B82F6', 'Physics and chemistry fundamentals'),
      ('Life Sciences', '🧬', '#10B981', 'Biology, genetics, ecology'),
      ('Accounting', '💰', '#F59E0B', 'Financial and managerial accounting'),
      ('English', '📖', '#EF4444', 'English language, literature, and writing'),
      ('Geography', '🌍', '#06B6D4', 'Physical and human geography'),
      ('History', '🏛️', '#8B5CF6', 'African and world history'),
      ('Information Technology', '💻', '#6366F1', 'Programming, networks, cybersecurity'),
      ('Business Studies', '📊', '#F97316', 'Entrepreneurship, marketing, finance'),
      ('Economics', '📈', '#14B8A6', 'Micro and macroeconomics'),

      -- New subjects (South Africa CAPS/IEB) – consistent academic icons
      ('Mathematical Literacy', '📊', '#FCD34D', 'Applied mathematics for everyday life'),
      ('Agricultural Sciences', '🌾', '#65A30D', 'Farming, soil science, animal husbandry'),
      ('Afrikaans Home Language', '📘', '#EC4899', 'Afrikaans language and literature'),
      ('Afrikaans First Additional Language', '📘', '#EC4899', 'Afrikaans as additional language'),
      ('English Home Language', '📘', '#EF4444', 'English language, literature, and writing'),
      ('English First Additional Language', '📘', '#EF4444', 'English as additional language'),
      ('isiZulu Home Language', '📘', '#8B5CF6', 'isiZulu language and literature'),
      ('isiXhosa Home Language', '📘', '#8B5CF6', 'isiXhosa language and literature'),
      ('Sepedi Home Language', '📘', '#8B5CF6', 'Sepedi language and literature'),
      ('Setswana Home Language', '📘', '#8B5CF6', 'Setswana language and literature'),
      ('Siswati Home Language', '📘', '#8B5CF6', 'Siswati language and literature'),
      ('Tshivenda Home Language', '📘', '#8B5CF6', 'Tshivenda language and literature'),
      ('Xitsonga Home Language', '📘', '#8B5CF6', 'Xitsonga language and literature'),
      ('Computer Applications Technology (CAT)', '🖥️', '#3B82F6', 'Practical IT skills, office applications'),
      ('Engineering Graphics and Design (EGD)', '📐', '#F59E0B', 'Technical drawing and design'),
      ('Life Orientation', '🧘', '#10B981', 'Personal development, health, and social responsibility'),
      ('Tourism', '✈️', '#06B6D4', 'Tourism industry, travel, and hospitality'),
      ('Consumer Studies', '🛒', '#F97316', 'Consumer rights, budgeting, and home management'),
      ('Visual Arts', '🎨', '#EC4899', 'Fine arts, painting, sculpture, and design'),
      ('Music', '🎵', '#8B5CF6', 'Music theory, performance, and composition'),
      ('Dramatic Arts', '🎭', '#EF4444', 'Drama, theatre, and performance art'),
      ('Religion Studies', '⛪', '#FCD34D', 'Religious traditions and ethics'),
      ('Hospitality Studies', '🍽️', '#F59E0B', 'Hospitality, catering, and event management'),
      ('Design', '✏️', '#06B6D4', 'Design principles and practical design')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 5. Seed curricula if not already present (this may already exist from earlier seeds)
    const curriculaCheck = await client.query('SELECT COUNT(*) FROM curricula');
    if (parseInt(curriculaCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO curricula (country_id, name) VALUES
        ((SELECT id FROM countries WHERE code = 'ZA'), 'CAPS'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'IEB'),
        ((SELECT id FROM countries WHERE code = 'KE'), 'CBC'),
        ((SELECT id FROM countries WHERE code = 'NG'), 'WAEC'),
        ((SELECT id FROM countries WHERE code = 'ZW'), 'ZIMSEC')
      `);
    }

    // 6. Link explicit CAPS and IEB subjects (using ZA country and curriculum name)
    await client.query(`
      DO $$
      DECLARE
        caps_id INTEGER;
        ieb_id INTEGER;
        sub_name TEXT;
        sub_id INTEGER;
        caps_subjects TEXT[] := ARRAY[
          'Mathematics',
          'Mathematical Literacy',
          'Physical Sciences',
          'Life Sciences',
          'Agricultural Sciences',
          'Accounting',
          'Business Studies',
          'Economics',
          'Geography',
          'History',
          'English Home Language',
          'English First Additional Language',
          'Afrikaans Home Language',
          'Afrikaans First Additional Language',
          'isiZulu Home Language',
          'isiXhosa Home Language',
          'Sepedi Home Language',
          'Setswana Home Language',
          'Siswati Home Language',
          'Tshivenda Home Language',
          'Xitsonga Home Language',
          'Information Technology',
          'Computer Applications Technology (CAT)',
          'Engineering Graphics and Design (EGD)',
          'Life Orientation',
          'Tourism',
          'Consumer Studies',
          'Visual Arts',
          'Music',
          'Dramatic Arts',
          'Religion Studies',
          'Hospitality Studies',
          'Design'
        ];
      BEGIN
        -- Get CAPS and IEB using country 'ZA' and name
        SELECT c.id INTO caps_id
        FROM curricula c
        JOIN countries co ON co.id = c.country_id
        WHERE co.code = 'ZA' AND c.name = 'CAPS';

        SELECT c.id INTO ieb_id
        FROM curricula c
        JOIN countries co ON co.id = c.country_id
        WHERE co.code = 'ZA' AND c.name = 'IEB';

        IF caps_id IS NULL OR ieb_id IS NULL THEN
          RAISE NOTICE 'CAPS or IEB not found for ZA, skipping curriculum-subject links.';
          RETURN;
        END IF;

        FOREACH sub_name IN ARRAY caps_subjects LOOP
          SELECT id INTO sub_id FROM subjects WHERE name = sub_name;
          IF sub_id IS NOT NULL THEN
            INSERT INTO curriculum_subjects (curriculum_id, subject_id)
            VALUES (caps_id, sub_id)
            ON CONFLICT (curriculum_id, subject_id) DO NOTHING;

            INSERT INTO curriculum_subjects (curriculum_id, subject_id)
            VALUES (ieb_id, sub_id)
            ON CONFLICT (curriculum_id, subject_id) DO NOTHING;
          END IF;
        END LOOP;
      END $$;
    `);

    // 7. Seed countries/provinces/education levels if empty (kept from earlier)
    // (These may already be seeded; we'll keep them idempotent)
    const countriesCheck = await client.query('SELECT COUNT(*) FROM countries');
    if (parseInt(countriesCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO countries (name, code) VALUES
        ('South Africa', 'ZA'),
        ('Kenya', 'KE'),
        ('Nigeria', 'NG'),
        ('Zimbabwe', 'ZW'),
        ('Botswana', 'BW'),
        ('Ghana', 'GH')
      `);
      // Insert provinces for South Africa
      await client.query(`
        INSERT INTO provinces (country_id, name) VALUES
        ((SELECT id FROM countries WHERE code = 'ZA'), 'Gauteng'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'Western Cape'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'KwaZulu-Natal'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'Eastern Cape'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'Free State'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'Limpopo'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'Mpumalanga'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'North West'),
        ((SELECT id FROM countries WHERE code = 'ZA'), 'Northern Cape')
      `);
      // Add provinces for Kenya, Nigeria, etc. (optional)
      await client.query(`
        INSERT INTO provinces (country_id, name) VALUES
        ((SELECT id FROM countries WHERE code = 'KE'), 'Nairobi'),
        ((SELECT id FROM countries WHERE code = 'KE'), 'Mombasa'),
        ((SELECT id FROM countries WHERE code = 'KE'), 'Kisumu'),
        ((SELECT id FROM countries WHERE code = 'NG'), 'Lagos'),
        ((SELECT id FROM countries WHERE code = 'NG'), 'Abuja'),
        ((SELECT id FROM countries WHERE code = 'ZW'), 'Harare'),
        ((SELECT id FROM countries WHERE code = 'ZW'), 'Bulawayo')
      `);
    }

    // Seed education levels if empty
    const levelsCheck = await client.query('SELECT COUNT(*) FROM education_levels');
    if (parseInt(levelsCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO education_levels (name, sort_order) VALUES
        ('High School', 1),
        ('TVET College', 2),
        ('University', 3),
        ('Other', 4)
      `);
    }

    // Commit all changes
    await client.query('COMMIT');
    console.log('✅ Database tables and schema migrations initialized');
    console.log('✅ Stage 2: Subject catalogue expanded and linked to CAPS/IEB');
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