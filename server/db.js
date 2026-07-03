// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    // ----- TABLES -----
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
        subjects JSONB DEFAULT '[]'::jsonb,
        role VARCHAR(20) DEFAULT 'learner',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
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

    // ----- SEED DATA -----
    // 1. Countries
    const countries = [
      { name: 'South Africa', code: 'ZA' },
      { name: 'Kenya', code: 'KE' },
      { name: 'Nigeria', code: 'NG' },
      { name: 'Zimbabwe', code: 'ZW' },
      { name: 'Botswana', code: 'BW' },
      { name: 'Namibia', code: 'NA' },
      { name: 'Ghana', code: 'GH' },
      { name: 'Egypt', code: 'EG' },
      { name: 'Uganda', code: 'UG' },
      { name: 'Tanzania', code: 'TZ' },
      { name: 'Zambia', code: 'ZM' },
      { name: 'Mozambique', code: 'MZ' },
      { name: 'Angola', code: 'AO' },
      { name: 'Cameroon', code: 'CM' },
      { name: 'Ethiopia', code: 'ET' },
      { name: 'Morocco', code: 'MA' }
    ];
    for (const c of countries) {
      await client.query(
        'INSERT INTO countries (name, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
        [c.name, c.code]
      );
    }

    // 2. Education levels
    const levels = ['High School', 'TVET College', 'University', 'Other'];
    for (const lv of levels) {
      await client.query(
        'INSERT INTO education_levels (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [lv]
      );
    }

    // 3. Provinces for SA
    const saProvinces = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'];
    for (const p of saProvinces) {
      await client.query(
        `INSERT INTO provinces (country_id, name)
         VALUES ((SELECT id FROM countries WHERE code = 'ZA'), $1)
         ON CONFLICT (country_id, name) DO NOTHING`,
        [p]
      );
    }

    // 4. Curricula
    const curricula = [
      { countryCode: 'ZA', name: 'CAPS' },
      { countryCode: 'ZA', name: 'IEB' },
      { countryCode: 'KE', name: 'CBC' },
      { countryCode: 'KE', name: '8-4-4' },
      { countryCode: 'NG', name: 'WAEC' },
      { countryCode: 'NG', name: 'NECO' },
      { countryCode: 'ZW', name: 'ZIMSEC' },
      { countryCode: 'ZW', name: 'Cambridge' }
    ];
    for (const cur of curricula) {
      await client.query(
        `INSERT INTO curricula (country_id, name)
         VALUES ((SELECT id FROM countries WHERE code = $1), $2)
         ON CONFLICT (country_id, name) DO NOTHING`,
        [cur.countryCode, cur.name]
      );
    }

    // 5. Grades
    const gradeData = [
      { level: 'High School', names: ['Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'] },
      { level: 'TVET College', names: ['N1','N2','N3','N4','N5','N6'] },
      { level: 'University', names: ['First Year','Second Year','Third Year','Fourth Year','Postgraduate'] },
      { level: 'Other', names: ['Other'] }
    ];
    for (const g of gradeData) {
      const levelId = await client.query('SELECT id FROM education_levels WHERE name = $1', [g.level]);
      if (levelId.rows.length) {
        for (const name of g.names) {
          await client.query(
            `INSERT INTO grades (education_level_id, name, display_name)
             VALUES ($1, $2, $2)
             ON CONFLICT (education_level_id, name) DO NOTHING`,
            [levelId.rows[0].id, name]
          );
        }
      }
    }

    // 6. Subjects for CAPS (curriculum_id = 1)
    const capsId = await client.query(
      `SELECT id FROM curricula WHERE name = 'CAPS' AND country_id = (SELECT id FROM countries WHERE code = 'ZA')`
    );
    if (capsId.rows.length) {
      const cid = capsId.rows[0].id;
      const gradeNames = ['Grade 10', 'Grade 11', 'Grade 12'];
      const subjectLists = {
        'Grade 10': ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
        'Grade 11': ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
        'Grade 12': ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design']
      };
      for (const gname of gradeNames) {
        const gradeRow = await client.query('SELECT id FROM grades WHERE name = $1', [gname]);
        if (gradeRow.rows.length) {
          const gid = gradeRow.rows[0].id;
          const subjects = subjectLists[gname] || [];
          for (const sub of subjects) {
            await client.query(
              `INSERT INTO subjects (curriculum_id, grade_id, name)
               VALUES ($1, $2, $3)
               ON CONFLICT (curriculum_id, grade_id, name) DO NOTHING`,
              [cid, gid, sub]
            );
          }
        }
      }
      // University subjects (for grade "First Year" etc.)
      const uniGrades = ['First Year','Second Year','Third Year','Fourth Year','Postgraduate'];
      const uniSubjects = ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'];
      for (const gname of uniGrades) {
        const gradeRow = await client.query('SELECT id FROM grades WHERE name = $1', [gname]);
        if (gradeRow.rows.length) {
          const gid = gradeRow.rows[0].id;
          for (const sub of uniSubjects) {
            await client.query(
              `INSERT INTO subjects (curriculum_id, grade_id, name)
               VALUES ($1, $2, $3)
               ON CONFLICT (curriculum_id, grade_id, name) DO NOTHING`,
              [cid, gid, sub]
            );
          }
        }
      }
    }
    console.log('✅ Database tables and default data ready');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };