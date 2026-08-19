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
        order_number INTEGER DEFAULT 0
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

    // ===== ALTER EXISTING TABLES (safe) =====
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_question_count INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_question_date DATE;

      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS start_date TIMESTAMP DEFAULT NOW();
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS transaction_ref VARCHAR(100);
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `);

    // ===== MIGRATE TOPICS UNIQUE CONSTRAINT =====
    await client.query(`
      DO $$
      DECLARE
        old_constraint_name TEXT;
        dup_count INTEGER;
        rec RECORD;
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'topics'::regclass
            AND conname = 'topics_subject_id_curriculum_id_grade_title_key'
        ) THEN
          SELECT conname INTO old_constraint_name
          FROM pg_constraint
          WHERE conrelid = 'topics'::regclass
            AND contype = 'u'
            AND conkey = (
              SELECT array_agg(attnum)
              FROM pg_attribute
              WHERE attrelid = 'topics'::regclass
                AND attname IN ('subject_id', 'title')
            )
            AND array_length(conkey, 1) = 2;

          SELECT COUNT(*) INTO dup_count FROM (
            SELECT subject_id, curriculum_id, grade, title, COUNT(*)
            FROM topics
            GROUP BY subject_id, curriculum_id, grade, title
            HAVING COUNT(*) > 1
          ) AS duplicates;

          IF dup_count > 0 THEN
            RAISE NOTICE '⚠️ Duplicate topics found that would violate new unique constraint. Skipping migration.';
            FOR rec IN SELECT subject_id, curriculum_id, grade, title, COUNT(*) FROM topics
                       GROUP BY subject_id, curriculum_id, grade, title HAVING COUNT(*) > 1 LOOP
              RAISE NOTICE '   Duplicate: subject_id=%, curriculum_id=%, grade=%, title=% (% rows)',
                rec.subject_id, rec.curriculum_id, rec.grade, rec.title, rec.count;
            END LOOP;
          ELSE
            IF old_constraint_name IS NOT NULL THEN
              EXECUTE format('ALTER TABLE topics DROP CONSTRAINT %I', old_constraint_name);
              RAISE NOTICE '✅ Dropped old constraint: %', old_constraint_name;
            END IF;

            ALTER TABLE topics ADD CONSTRAINT topics_subject_id_curriculum_id_grade_title_key
              UNIQUE (subject_id, curriculum_id, grade, title);
            RAISE NOTICE '✅ New unique constraint added.';
          END IF;
        ELSE
          RAISE NOTICE '✅ New topics unique constraint already exists.';
        END IF;
      END $$;
    `);

    // ===== SEED LOOKUP DATA (idempotent) =====
    await client.query(`
      INSERT INTO countries (name, code) VALUES
      ('South Africa', 'ZA'),
      ('Kenya', 'KE'),
      ('Nigeria', 'NG'),
      ('Zimbabwe', 'ZW'),
      ('Botswana', 'BW'),
      ('Ghana', 'GH')
      ON CONFLICT (code) DO NOTHING;

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

      INSERT INTO education_levels (name, sort_order) VALUES
      ('High School', 1),
      ('TVET College', 2),
      ('University', 3),
      ('Other', 4)
      ON CONFLICT (name) DO NOTHING;

      INSERT INTO curricula (country_id, name) VALUES
      ((SELECT id FROM countries WHERE code = 'ZA'), 'CAPS'),
      ((SELECT id FROM countries WHERE code = 'ZA'), 'IEB'),
      ((SELECT id FROM countries WHERE code = 'KE'), 'CBC'),
      ((SELECT id FROM countries WHERE code = 'NG'), 'WAEC'),
      ((SELECT id FROM countries WHERE code = 'ZW'), 'ZIMSEC')
      ON CONFLICT (country_id, name) DO NOTHING;
    `);

    // ===== SEED SUBJECTS (master list) =====
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
      const exists = await client.query('SELECT 1 FROM subjects WHERE name = $1', [sub.name]);
      if (exists.rows.length === 0) {
        await client.query(
          'INSERT INTO subjects (name, icon, color, description) VALUES ($1, $2, $3, $4)',
          [sub.name, sub.icon, sub.color, sub.desc]
        );
      }
    }

    // ===== LINK ALL SUBJECTS TO ALL SOUTH AFRICAN CURRICULA =====
    const curRes = await client.query(`
      SELECT c.id, c.name
      FROM curricula c
      JOIN countries co ON co.id = c.country_id
      WHERE co.code = 'ZA'
        AND c.name IN ('CAPS', 'IEB', 'CBC', 'WAEC', 'ZIMSEC')
    `);
    const curriculumIds = curRes.rows.map(r => r.id);

    const subjectsRes = await client.query('SELECT id FROM subjects');
    const subjectIds = subjectsRes.rows.map(r => r.id);

    for (const curId of curriculumIds) {
      for (const subId of subjectIds) {
        await client.query(`
          INSERT INTO curriculum_subjects (curriculum_id, subject_id)
          VALUES ($1, $2)
          ON CONFLICT (curriculum_id, subject_id) DO NOTHING
        `, [curId, subId]);
      }
    }
    console.log(`✅ Linked ${subjectIds.length} subjects to ${curriculumIds.length} curricula.`);

    // ===== SEED CAPS TOPICS =====
    await client.query(`
      DO $$
      DECLARE
        caps_id INTEGER;
        math_id INTEGER;
        phys_id INTEGER;
        life_id INTEGER;
        acc_id INTEGER;
        subject_record RECORD;
        grade_text TEXT;
        topic_record RECORD;
      BEGIN
        SELECT id INTO caps_id FROM curricula WHERE name = 'CAPS' AND country_id = (SELECT id FROM countries WHERE code = 'ZA');
        IF caps_id IS NULL THEN
          RAISE NOTICE 'CAPS curriculum not found, skipping topic seed.';
          RETURN;
        END IF;

        SELECT id INTO math_id FROM subjects WHERE name = 'Mathematics';
        SELECT id INTO phys_id FROM subjects WHERE name = 'Physical Sciences';
        SELECT id INTO life_id FROM subjects WHERE name = 'Life Sciences';
        SELECT id INTO acc_id FROM subjects WHERE name = 'Accounting';

        IF math_id IS NULL OR phys_id IS NULL OR life_id IS NULL OR acc_id IS NULL THEN
          RAISE NOTICE 'One or more required CAPS subjects were not found. Skipping topic seed.';
          RETURN;
        END IF;

        CREATE TEMP TABLE temp_topics (
          subject_id INTEGER,
          grade VARCHAR(20),
          title VARCHAR(200),
          description TEXT,
          order_number INTEGER
        );

        -- ===== Mathematics =====
        INSERT INTO temp_topics VALUES
        (math_id, 'Grade 10', 'Algebra – Expressions and Equations', 'Simplifying expressions, solving linear and quadratic equations', 1),
        (math_id, 'Grade 10', 'Algebra – Exponents and Surds', 'Laws of exponents, simplification of surds', 2),
        (math_id, 'Grade 10', 'Algebra – Inequalities', 'Solving linear and quadratic inequalities', 3),
        (math_id, 'Grade 10', 'Number Patterns', 'Arithmetic and geometric sequences', 4),
        (math_id, 'Grade 10', 'Functions – Linear, Quadratic, Hyperbolic', 'Graphing and interpreting functions', 5),
        (math_id, 'Grade 10', 'Trigonometry – Basics', 'Trig ratios, special angles, and solving triangles', 6),
        (math_id, 'Grade 10', 'Euclidean Geometry – Lines and Angles', 'Parallel lines, triangles, and quadrilaterals', 7),
        (math_id, 'Grade 10', 'Statistics – Measures of Centre and Spread', 'Mean, median, mode, range, standard deviation', 8),
        (math_id, 'Grade 10', 'Probability – Basics', 'Theoretical and experimental probability', 9),

        (math_id, 'Grade 11', 'Algebra – Quadratic and Exponential', 'Solving quadratics, exponential equations, and logarithms', 1),
        (math_id, 'Grade 11', 'Algebra – Sequences and Series', 'Arithmetic, geometric, and sum to infinity', 2),
        (math_id, 'Grade 11', 'Trigonometry – Identities and Equations', 'Proving identities, solving trigonometric equations', 3),
        (math_id, 'Grade 11', 'Trigonometry – Sine, Cosine, Area Rules', 'Application of sine, cosine, and area rules', 4),
        (math_id, 'Grade 11', 'Functions – Advanced', 'Inverse functions, composite functions, and transformations', 5),
        (math_id, 'Grade 11', 'Euclidean Geometry – Advanced', 'Proofs in circle geometry and similar triangles', 6),
        (math_id, 'Grade 11', 'Statistics – Correlation and Regression', 'Scatter plots, least‑squares regression, and interpretation', 7),
        (math_id, 'Grade 11', 'Finance – Simple and Compound Interest', 'Interest calculations and loan amortisation', 8),
        (math_id, 'Grade 11', 'Probability – Counting Principles', 'Permutations, combinations, and probability theorems', 9),

        (math_id, 'Grade 12', 'Calculus – Limits and Continuity', 'Concept of limits, continuity, and derivative definition', 1),
        (math_id, 'Grade 12', 'Calculus – Differentiation', 'Rules of differentiation, tangents, and optimisation', 2),
        (math_id, 'Grade 12', 'Calculus – Integration', 'Indefinite and definite integrals, area under curve', 3),
        (math_id, 'Grade 12', 'Algebra – Sequences and Series (Application)', 'Application of sequences and series in finance', 4),
        (math_id, 'Grade 12', 'Trigonometry – Compound Angles', 'Compound angle identities and application', 5),
        (math_id, 'Grade 12', 'Analytical Geometry', 'Lines, circles, and conic sections', 6),
        (math_id, 'Grade 12', 'Finance – Annuities and Loans', 'Compound interest, annuities, and loan calculations', 7),
        (math_id, 'Grade 12', 'Probability – Advanced', 'Contingency tables, tree diagrams, and conditional probability', 8),
        (math_id, 'Grade 12', 'Statistics – Distribution and Regression', 'Normal distribution, sampling, and confidence intervals', 9);

        -- ===== Physical Sciences =====
        INSERT INTO temp_topics VALUES
        (phys_id, 'Grade 10', 'Mechanics – Motion', 'Position, displacement, velocity, acceleration, and graphs', 1),
        (phys_id, 'Grade 10', 'Mechanics – Forces', 'Newton''s laws, friction, and equilibrium', 2),
        (phys_id, 'Grade 10', 'Waves – Sound and Light', 'Wave properties, reflection, refraction, and diffraction', 3),
        (phys_id, 'Grade 10', 'Electricity – Circuits', 'Ohm''s law, series/parallel circuits, and resistance', 4),
        (phys_id, 'Grade 10', 'Matter – Atomic Structure', 'Atoms, elements, periodic table, and chemical bonding', 5),
        (phys_id, 'Grade 10', 'Matter – Stoichiometry', 'Mole concept, molar mass, and calculations', 6),
        (phys_id, 'Grade 10', 'Energy – Forms and Conservation', 'Kinetic, potential, and conservation of energy', 7),

        (phys_id, 'Grade 11', 'Mechanics – Newton''s Laws', 'Applying Newton''s laws, momentum, and impulse', 1),
        (phys_id, 'Grade 11', 'Mechanics – Work, Energy, Power', 'Work, energy conservation, power, and efficiency', 2),
        (phys_id, 'Grade 11', 'Waves – Sound and Light', 'Doppler effect, electromagnetic spectrum', 3),
        (phys_id, 'Grade 11', 'Electricity – Circuits', 'Kirchhoff''s laws, internal resistance, and power', 4),
        (phys_id, 'Grade 11', 'Matter – Chemical Bonding', 'Ionic, covalent, and metallic bonding', 5),
        (phys_id, 'Grade 11', 'Matter – Stoichiometry', 'Molar concentration, limiting reagents, and yield', 6),
        (phys_id, 'Grade 11', 'Thermodynamics – Heat and Temperature', 'Heat capacity, latent heat, and phase changes', 7),

        (phys_id, 'Grade 12', 'Mechanics – Projectile Motion', '2‑D motion, independence of horizontal/vertical motion', 1),
        (phys_id, 'Grade 12', 'Mechanics – Work‑Energy Theorem', 'Application of work‑energy and conservation', 2),
        (phys_id, 'Grade 12', 'Waves – Doppler Effect', 'Doppler effect with sound and light, applications', 3),
        (phys_id, 'Grade 12', 'Electricity – AC Circuits', 'Alternating current, impedance, and power factor', 4),
        (phys_id, 'Grade 12', 'Matter – Organic Chemistry', 'Functional groups, isomerism, and reactions', 5),
        (phys_id, 'Grade 12', 'Matter – Equilibrium', 'Chemical equilibrium, Le Chatelier''s principle', 6),
        (phys_id, 'Grade 12', 'Nuclear Physics – Radioactivity', 'Radioactive decay, half‑life, and nuclear reactions', 7);

        -- ===== Life Sciences =====
        INSERT INTO temp_topics VALUES
        (life_id, 'Grade 10', 'Cell Biology – Structure and Function', 'Cell organelles, cell theory, and cell transport', 1),
        (life_id, 'Grade 10', 'DNA and Genetics', 'DNA structure, replication, and protein synthesis', 2),
        (life_id, 'Grade 10', 'Human Systems – Digestive and Respiratory', 'Anatomy and physiology of digestion and respiration', 3),
        (life_id, 'Grade 10', 'Ecology – Introduction', 'Ecosystems, energy flow, and nutrient cycling', 4),
        (life_id, 'Grade 10', 'Plant Anatomy and Function', 'Structure of roots, stems, leaves, and transpiration', 5),
        (life_id, 'Grade 10', 'Biodiversity', 'Classification, kingdoms, and importance of biodiversity', 6),

        (life_id, 'Grade 11', 'Cell Division – Mitosis and Meiosis', 'Stages, differences, and significance of division', 1),
        (life_id, 'Grade 11', 'Genetics – Inheritance', 'Mendelian genetics, Punnett squares, and pedigree analysis', 2),
        (life_id, 'Grade 11', 'Human Systems – Excretion', 'Kidney structure, urine formation, and regulation', 3),
        (life_id, 'Grade 11', 'Human Systems – Nervous System', 'Neurons, reflex arcs, brain structure, and disorders', 4),
        (life_id, 'Grade 11', 'Biodiversity – Diversity of Life', 'Diversity of animals, plants, and ecological importance', 5),
        (life_id, 'Grade 11', 'Microorganisms', 'Bacteria, viruses, fungi, and their roles', 6),

        (life_id, 'Grade 12', 'Evolution – Natural Selection', 'Darwin, evidence for evolution, and speciation', 1),
        (life_id, 'Grade 12', 'Human Reproduction', 'Male and female reproductive systems, gametogenesis, and cycles', 2),
        (life_id, 'Grade 12', 'Human Systems – Endocrine', 'Hormones, glands, and feedback control', 3),
        (life_id, 'Grade 12', 'Human Systems – Respiratory and Homeostasis', 'Gas exchange, acid‑base balance, and regulation', 4),
        (life_id, 'Grade 12', 'Ecology and Environment', 'Population ecology, community dynamics, and conservation', 5),
        (life_id, 'Grade 12', 'Genetics – DNA and Technology', 'DNA profiling, genetic engineering, and biotechnology', 6);

        -- ===== Accounting =====
        INSERT INTO temp_topics VALUES
        (acc_id, 'Grade 10', 'Accounting Concepts', 'Accounting equation, double‑entry system, and basic terminology', 1),
        (acc_id, 'Grade 10', 'Journals and Ledgers', 'Recording transactions in journals and posting to ledgers', 2),
        (acc_id, 'Grade 10', 'Financial Statements – Income Statement', 'Preparing income statement for sole trader', 3),
        (acc_id, 'Grade 10', 'Financial Statements – Balance Sheet', 'Preparing balance sheet for sole trader', 4),
        (acc_id, 'Grade 10', 'VAT – Value Added Tax', 'VAT calculation, recording, and returns', 5),
        (acc_id, 'Grade 10', 'Bank Reconciliation', 'Bank statements, cash books, and reconciliation', 6),

        (acc_id, 'Grade 11', 'Adjustments and Closing Entries', 'Accruals, prepayments, depreciation, and closing entries', 1),
        (acc_id, 'Grade 11', 'Fixed Assets – Depreciation', 'Methods of depreciation and disposal of assets', 2),
        (acc_id, 'Grade 11', 'Partnerships – Accounting', 'Partnership agreements, capital, and current accounts', 3),
        (acc_id, 'Grade 11', 'Budgets', 'Cash budgets, projected income statements, and variance analysis', 4),
        (acc_id, 'Grade 11', 'Financial Analysis – Ratios', 'Liquidity, profitability, and solvency ratios', 5),
        (acc_id, 'Grade 11', 'Manufacturing Accounts', 'Cost accounting for manufacturing businesses', 6),

        (acc_id, 'Grade 12', 'Companies – Financial Statements', 'Company structure, financial statements, and notes', 1),
        (acc_id, 'Grade 12', 'Cash Flow Statements', 'Preparation and interpretation of cash flow statements', 2),
        (acc_id, 'Grade 12', 'Financial Analysis – Interpretation', 'Advanced ratio analysis, trend analysis, and limitations', 3),
        (acc_id, 'Grade 12', 'Consolidation', 'Basic consolidation concepts, inter‑company transactions', 4),
        (acc_id, 'Grade 12', 'Budgeting and Planning', 'Advanced budgeting, including capital budgeting', 5),
        (acc_id, 'Grade 12', 'Ethics in Accounting', 'Ethical issues, professional conduct, and corporate governance', 6);

        FOR topic_record IN SELECT * FROM temp_topics LOOP
          INSERT INTO topics (subject_id, curriculum_id, grade, title, description, order_number)
          VALUES (
            topic_record.subject_id,
            caps_id,
            topic_record.grade,
            topic_record.title,
            topic_record.description,
            topic_record.order_number
          )
          ON CONFLICT (subject_id, curriculum_id, grade, title) DO NOTHING;
        END LOOP;

        DROP TABLE temp_topics;
        RAISE NOTICE '✅ CAPS topics seeded for Mathematics, Physical Sciences, Life Sciences, Accounting (Grade 10, 11, 12).';
      END $$;
    `);

    // ===== HANDLE DUPLICATE SUBJECT NAMES (log only, do not abort) =====
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
    console.log('✅ Stage 2: Subject catalogue expanded and linked to all South African curricula.');
    console.log('✅ Stage 3: Topics unique constraint migrated and CAPS topics seeded.');
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