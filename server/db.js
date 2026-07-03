// server/db.js – SQLite version (no PostgreSQL needed)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../leago.db');
const db = new sqlite3.Database(dbPath);

function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function initDB() {
  try {
    // Users
    await runQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        country_id INTEGER,
        province_id INTEGER,
        education_level_id INTEGER,
        curriculum_id INTEGER,
        grade_id INTEGER,
        role TEXT DEFAULT 'learner',
        subjects TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Countries
    await runQuery(`
      CREATE TABLE IF NOT EXISTS countries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        code TEXT UNIQUE NOT NULL
      )
    `);

    // Provinces
    await runQuery(`
      CREATE TABLE IF NOT EXISTS provinces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id INTEGER REFERENCES countries(id),
        name TEXT NOT NULL,
        UNIQUE(country_id, name)
      )
    `);

    // Education levels
    await runQuery(`
      CREATE TABLE IF NOT EXISTS education_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        sort_order INTEGER DEFAULT 0
      )
    `);

    // Curricula
    await runQuery(`
      CREATE TABLE IF NOT EXISTS curricula (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id INTEGER REFERENCES countries(id),
        name TEXT NOT NULL,
        UNIQUE(country_id, name)
      )
    `);

    // Grades
    await runQuery(`
      CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        education_level_id INTEGER REFERENCES education_levels(id),
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(education_level_id, name)
      )
    `);

    // Subjects
    await runQuery(`
      CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        curriculum_id INTEGER REFERENCES curricula(id),
        grade_id INTEGER REFERENCES grades(id),
        name TEXT NOT NULL,
        UNIQUE(curriculum_id, grade_id, name)
      )
    `);

    // Subscriptions
    await runQuery(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'trial',
        start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_date DATETIME DEFAULT (datetime('now', '+3 days'))
      )
    `);

    // Progress
    await runQuery(`
      CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        topic_name TEXT,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, subject_id, topic_name)
      )
    `);

    // Seed default data
    await seedDefaultData();
    console.log('✅ Database tables ready (SQLite)');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
}

async function seedDefaultData() {
  // Countries
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
    await runQuery(
      'INSERT OR IGNORE INTO countries (name, code) VALUES (?, ?)',
      [c.name, c.code]
    );
  }

  // Education levels
  const levels = ['High School', 'TVET College', 'University', 'Other'];
  for (const lv of levels) {
    await runQuery('INSERT OR IGNORE INTO education_levels (name) VALUES (?)', [lv]);
  }

  // Provinces for SA
  const saProvinces = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'];
  for (const p of saProvinces) {
    await runQuery(
      'INSERT OR IGNORE INTO provinces (country_id, name) VALUES ((SELECT id FROM countries WHERE code = ?), ?)',
      ['ZA', p]
    );
  }

  // Curricula
  const curricula = [
    { code: 'ZA', name: 'CAPS' },
    { code: 'ZA', name: 'IEB' },
    { code: 'KE', name: 'CBC' },
    { code: 'KE', name: '8-4-4' },
    { code: 'NG', name: 'WAEC' },
    { code: 'NG', name: 'NECO' },
    { code: 'ZW', name: 'ZIMSEC' },
    { code: 'ZW', name: 'Cambridge' }
  ];
  for (const cur of curricula) {
    await runQuery(
      'INSERT OR IGNORE INTO curricula (country_id, name) VALUES ((SELECT id FROM countries WHERE code = ?), ?)',
      [cur.code, cur.name]
    );
  }

  // Grades
  const gradeData = [
    { level: 'High School', names: ['Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'] },
    { level: 'TVET College', names: ['N1','N2','N3','N4','N5','N6'] },
    { level: 'University', names: ['First Year','Second Year','Third Year','Fourth Year','Postgraduate'] },
    { level: 'Other', names: ['Other'] }
  ];
  for (const g of gradeData) {
    const levelRow = await getOne('SELECT id FROM education_levels WHERE name = ?', [g.level]);
    if (levelRow) {
      for (const name of g.names) {
        await runQuery(
          'INSERT OR IGNORE INTO grades (education_level_id, name, display_name) VALUES (?, ?, ?)',
          [levelRow.id, name, name]
        );
      }
    }
  }

  // Subjects for CAPS (curriculum_id = 1, country SA)
  const capsRow = await getOne(
    'SELECT id FROM curricula WHERE name = ? AND country_id = (SELECT id FROM countries WHERE code = ?)',
    ['CAPS', 'ZA']
  );
  if (capsRow) {
    const cid = capsRow.id;
    const gradeNames = ['Grade 10', 'Grade 11', 'Grade 12'];
    const subjectLists = {
      'Grade 10': ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
      'Grade 11': ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design'],
      'Grade 12': ['Mathematics', 'English Home Language', 'Afrikaans First Additional Language', 'Life Orientation', 'Life Sciences', 'Physical Sciences', 'History', 'Geography', 'Accounting', 'Business Studies', 'Economics', 'Engineering Graphics and Design', 'Computer Applications Technology', 'Information Technology', 'Consumer Studies', 'Tourism', 'Hospitality Studies', 'Agricultural Sciences', 'Visual Arts', 'Music', 'Drama', 'Design']
    };
    for (const gname of gradeNames) {
      const gradeRow = await getOne('SELECT id FROM grades WHERE name = ?', [gname]);
      if (gradeRow) {
        const gid = gradeRow.id;
        const subjects = subjectLists[gname] || [];
        for (const sub of subjects) {
          await runQuery(
            'INSERT OR IGNORE INTO subjects (curriculum_id, grade_id, name) VALUES (?, ?, ?)',
            [cid, gid, sub]
          );
        }
      }
    }
    // University subjects (for grades First Year etc.)
    const uniGrades = ['First Year','Second Year','Third Year','Fourth Year','Postgraduate'];
    const uniSubjects = ['Communication', 'Academic Writing', 'Critical Thinking', 'Research Skills', 'Computer Literacy', 'Mathematics for Science', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Accounting', 'Economics', 'Business Management', 'Marketing', 'Finance', 'Human Resources', 'Commercial Law', 'Criminal Law', 'Contract Law', 'Constitutional Law', 'Legal Research', 'Criminology', 'Psychology', 'Sociology', 'Social Work', 'Education (Foundation Phase)', 'Education (Intermediate Phase)', 'Educational Psychology', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering', 'Chemical Engineering', 'Programming Fundamentals', 'Database Systems', 'Networking', 'Web Development', 'Anatomy', 'Physiology', 'Pharmacology', 'Public Health', 'Nursing', 'Physiotherapy', 'English Literature', 'History', 'Philosophy', 'Political Science', 'Information Systems', 'Entrepreneurship', 'Project Management'];
    for (const gname of uniGrades) {
      const gradeRow = await getOne('SELECT id FROM grades WHERE name = ?', [gname]);
      if (gradeRow) {
        const gid = gradeRow.id;
        for (const sub of uniSubjects) {
          await runQuery(
            'INSERT OR IGNORE INTO subjects (curriculum_id, grade_id, name) VALUES (?, ?, ?)',
            [cid, gid, sub]
          );
        }
      }
    }
  }
}

const pool = {
  query: async (text, params) => {
    // This mimics the pg query method for compatibility with existing code.
    // We support parameterized queries with $1, $2, etc. and convert to ? for sqlite.
    if (text.toLowerCase().includes('select')) {
      const rows = await getAll(text.replace(/\$\d+/g, '?'), params);
      return { rows };
    } else {
      const result = await runQuery(text.replace(/\$\d+/g, '?'), params);
      return { rows: [] };
    }
  }
};

module.exports = { pool, initDB };