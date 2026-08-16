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

    // ===== 1. CREATE TABLES =====
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

      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS icon VARCHAR(50);
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS color VARCHAR(20);
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS description TEXT;

      CREATE TABLE IF NOT EXISTS curriculum_subjects (
        id SERIAL PRIMARY KEY,
        curriculum_id INTEGER REFERENCES curricula(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        UNIQUE(curriculum_id, subject_id)
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

    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_question_count INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_question_date DATE;
    `);

    // ===== 2. SEED COUNTRIES (idempotent) =====
    await client.query(`
      INSERT INTO countries (name, code) VALUES
      ('South Africa', 'ZA'),
      ('Kenya', 'KE'),
      ('Nigeria', 'NG'),
      ('Zimbabwe', 'ZW'),
      ('Botswana', 'BW'),
      ('Ghana', 'GH')
      ON CONFLICT (code) DO NOTHING;
    `);

    // ===== 3. SEED PROVINCES (idempotent) =====
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
      ON CONFLICT (country_id, name) DO NOTHING;
    `);

    // ===== 4. SEED EDUCATION LEVELS (idempotent) =====
    await client.query(`
      INSERT INTO education_levels (name, sort_order) VALUES
      ('High School', 1),
      ('TVET College', 2),
      ('University', 3),
      ('Other', 4)
      ON CONFLICT (name) DO NOTHING;
    `);

    // ===== 5. SEED CURRICULA (now countries exist) =====
    await client.query(`
      INSERT INTO curricula (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'ZA'), 'CAPS'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'IEB'),
      ((SELECT id FROM countries WHERE code = 'KE'), 'CBC'),
      ((SELECT id FROM countries WHERE code = 'NG'), 'WAEC'),
      ((SELECT id FROM countries WHERE code = 'ZW'), 'ZIMSEC')
      ON CONFLICT (country_id, name) DO NOTHING;
    `);

    // ===== 6. SEED SUBJECTS (master list) – idempotent =====
    const subjectList = [
      { name: 'Mathematics', icon: '📐', color: '#7C3AED', desc: 'Pure Mathematics – algebra, calculus, geometry' },
      { name: 'Physical Sciences', icon: '⚛️', color: '#3B82F6', desc: 'Physics and chemistry fundamentals' },
      { name: 'Life Sciences', icon: '🧬', color: '#10B981', desc: 'Biology, genetics, ecology' },
      { name: 'Accounting', icon: '💰', color: '#F59E0B', desc: 'Financial and managerial accounting' },
      { name: 'English', icon: '📖', color: '#EF4444', desc: 'English language, literature, and writing' },
      { name: 'Geography', icon: '🌍', color: '#06B6D4', desc: 'Physical and human geography' },
      { name: 'History', icon: '🏛️', color: '#8B5CF6', desc: 'African and world history' },
      { name: 'Information Technology', icon: '💻', color: '#6366F1', desc: 'Programming, networks, cybersecurity' },
      { name: 'Business Studies', icon: '📊', color: '#F97316', desc: 'Entrepreneurship, marketing, finance' },
      { name: 'Economics', icon: '📈', color: '#14B8A6', desc: 'Micro and macroeconomics' },
      { name: 'Mathematical Literacy', icon: '📊', color: '#FCD34D', desc: 'Applied mathematics for everyday life' },
      { name: 'Agricultural Sciences', icon: '🌾', color: '#65A30D', desc: 'Farming, soil science, animal husbandry' },
      { name: 'Afrikaans Home Language', icon: '📘', color: '#EC4899', desc: 'Afrikaans language and literature' },
      { name: 'Afrikaans First Additional Language', icon: '📘', color: '#EC4899', desc: 'Afrikaans as additional language' },
      { name: 'English Home Language', icon: '📘', color: '#EF4444', desc: 'English language, literature, and writing' },
      { name: 'English First Additional Language', icon: '📘', color: '#EF4444', desc: 'English as additional language' },
      { name: 'isiZulu Home Language', icon: '📘', color: '#8B5CF6', desc: 'isiZulu language and literature' },
      { name: 'isiXhosa Home Language', icon: '📘', color: '#8B5CF6', desc: 'isiXhosa language and literature' },
      { name: 'Sepedi Home Language', icon: '📘', color: '#8B5CF6', desc: 'Sepedi language and literature' },
      { name: 'Setswana Home Language', icon: '📘', color: '#8B5CF6', desc: 'Setswana language and literature' },
      { name: 'Siswati Home Language', icon: '📘', color: '#8B5CF6', desc: 'Siswati language and literature' },
      { name: 'Tshivenda Home Language', icon: '📘', color: '#8B5CF6', desc: 'Tshivenda language and literature' },
      { name: 'Xitsonga Home Language', icon: '📘', color: '#8B5CF6', desc: 'Xitsonga language and literature' },
      { name: 'Computer Applications Technology (CAT)', icon: '🖥️', color: '#3B82F6', desc: 'Practical IT skills, office applications' },
      { name: 'Engineering Graphics and Design (EGD)', icon: '📐', color: '#F59E0B', desc: 'Technical drawing and design' },
      { name: 'Life Orientation', icon: '🧘', color: '#10B981', desc: 'Personal development, health, and social responsibility' },
      { name: 'Tourism', icon: '✈️', color: '#06B6D4', desc: 'Tourism industry, travel, and hospitality' },
      { name: 'Consumer Studies', icon: '🛒', color: '#F97316', desc: 'Consumer rights, budgeting, and home management' },
      { name: 'Visual Arts', icon: '🎨', color: '#EC4899', desc: 'Fine arts, painting, sculpture, and design' },
      { name: 'Music', icon: '🎵', color: '#8B5CF6', desc: 'Music theory, performance, and composition' },
      { name: 'Dramatic Arts', icon: '🎭', color: '#EF4444', desc: 'Drama, theatre, and performance art' },
      { name: 'Religion Studies', icon: '⛪', color: '#FCD34D', desc: 'Religious traditions and ethics' },
      { name: 'Hospitality Studies', icon: '🍽️', color: '#F59E0B', desc: 'Hospitality, catering, and event management' },
      { name: 'Design', icon: '✏️', color: '#06B6D4', desc: 'Design principles and practical design' }
    ];

    for (const sub of subjectList) {
      // Insert only if not exists
      const exists = await client.query('SELECT 1 FROM subjects WHERE name = $1', [sub.name]);
      if (exists.rows.length === 0) {
        await client.query(
          'INSERT INTO subjects (name, icon, color, description) VALUES ($1, $2, $3, $4)',
          [sub.name, sub.icon, sub.color, sub.desc]
        );
      }
    }

    // ===== 7. LINK SUBJECTS TO CAPS AND IEB =====
    // Get CAPS and IEB IDs (they now exist)
    const curRes = await client.query(`
      SELECT c.id, c.name
      FROM curricula c
      JOIN countries co ON co.id = c.country_id
      WHERE co.code = 'ZA' AND c.name IN ('CAPS', 'IEB')
    `);
    const capsId = curRes.rows.find(r => r.name === 'CAPS')?.id;
    const iebId = curRes.rows.find(r => r.name === 'IEB')?.id;

    if (capsId && iebId) {
      const capsSubjects = [
        'Mathematics', 'Mathematical Literacy', 'Physical Sciences', 'Life Sciences',
        'Agricultural Sciences', 'Accounting', 'Business Studies', 'Economics',
        'Geography', 'History', 'English Home Language', 'English First Additional Language',
        'Afrikaans Home Language', 'Afrikaans First Additional Language',
        'isiZulu Home Language', 'isiXhosa Home Language', 'Sepedi Home Language',
        'Setswana Home Language', 'Siswati Home Language', 'Tshivenda Home Language',
        'Xitsonga Home Language', 'Information Technology', 'Computer Applications Technology (CAT)',
        'Engineering Graphics and Design (EGD)', 'Life Orientation', 'Tourism',
        'Consumer Studies', 'Visual Arts', 'Music', 'Dramatic Arts', 'Religion Studies',
        'Hospitality Studies', 'Design'
      ];
      for (const subName of capsSubjects) {
        const subRes = await client.query('SELECT id FROM subjects WHERE name = $1', [subName]);
        if (subRes.rows.length > 0) {
          const subId = subRes.rows[0].id;
          // Link to CAPS
          await client.query(`
            INSERT INTO curriculum_subjects (curriculum_id, subject_id)
            VALUES ($1, $2)
            ON CONFLICT (curriculum_id, subject_id) DO NOTHING
          `, [capsId, subId]);
          // Link to IEB
          await client.query(`
            INSERT INTO curriculum_subjects (curriculum_id, subject_id)
            VALUES ($1, $2)
            ON CONFLICT (curriculum_id, subject_id) DO NOTHING
          `, [iebId, subId]);
        }
      }
      console.log(`✅ Linked ${capsSubjects.length} subjects to CAPS and IEB.`);
    } else {
      console.warn('⚠️ CAPS or IEB curriculum not found, skipping subject linking.');
    }

    // ===== 8. HANDLE DUPLICATE SUBJECT NAMES (log only, do not abort) =====
    const dupCheck = await client.query(`
      SELECT name, COUNT(*) FROM subjects GROUP BY name HAVING COUNT(*) > 1
    `);
    if (dupCheck.rows.length > 0) {
      console.warn('⚠️ Duplicate subject names found:');
      dupCheck.rows.forEach(row => {
        console.warn(`   "${row.name}" appears ${row.count} times`);
      });
      console.warn('⚠️ Unique constraint on subjects.name will not be added.');
    } else {
      // No duplicates – add unique constraint if missing
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
      console.log('✅ Unique constraint on subjects.name added.');
    }

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