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
        -- Check if the new constraint already exists
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'topics'::regclass
            AND conname = 'topics_subject_id_curriculum_id_grade_title_key'
        ) THEN
          -- Find the old unique constraint (subject_id, title) if it exists
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

          -- Check for duplicates that would violate the new constraint
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
            -- Safe to migrate: drop old constraint if it exists
            IF old_constraint_name IS NOT NULL THEN
              EXECUTE format('ALTER TABLE topics DROP CONSTRAINT %I', old_constraint_name);
              RAISE NOTICE '✅ Dropped old constraint: %', old_constraint_name;
            END IF;

            -- Add new constraint
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

    // ===== LINK SUBJECTS TO CAPS AND IEB =====
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
          await client.query(`
            INSERT INTO curriculum_subjects (curriculum_id, subject_id)
            VALUES ($1, $2)
            ON CONFLICT (curriculum_id, subject_id) DO NOTHING
          `, [capsId, subId]);
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

    // ===== SEED CAPS TOPICS FOR ALL SUBJECTS (Grades 10, 11, 12) =====
    await client.query(`
      DO $$
      DECLARE
        caps_id INTEGER;
        subject_record RECORD;
        topic_record RECORD;
        grade_text TEXT;
        subject_name TEXT;
        topic_data JSONB;
        topics_for_subject JSONB;
        grade_array TEXT[] := ARRAY['Grade 10', 'Grade 11', 'Grade 12'];
      BEGIN
        -- Get CAPS curriculum ID
        SELECT id INTO caps_id FROM curricula WHERE name = 'CAPS' AND country_id = (SELECT id FROM countries WHERE code = 'ZA');
        IF caps_id IS NULL THEN
          RAISE NOTICE 'CAPS curriculum not found, skipping topic seed.';
          RETURN;
        END IF;

        -- Create a temporary table to hold all topics
        CREATE TEMP TABLE temp_topics (
          subject_id INTEGER,
          grade VARCHAR(20),
          title VARCHAR(200),
          description TEXT,
          order_number INTEGER
        );

        -- Define a comprehensive lookup of topics for each subject.
        -- The keys are the exact subject names as in the subjects table.
        -- Each value is a JSON object with keys 'Grade 10', 'Grade 11', 'Grade 12'
        -- and an array of { title, description, order_number } objects.
        topic_data := '{
          "Mathematics": {
            "Grade 10": [
              {"title": "Algebra – Expressions and Equations", "description": "Simplifying expressions, solving linear and quadratic equations", "order": 1},
              {"title": "Algebra – Exponents and Surds", "description": "Laws of exponents, simplification of surds", "order": 2},
              {"title": "Algebra – Inequalities", "description": "Solving linear and quadratic inequalities", "order": 3},
              {"title": "Number Patterns", "description": "Arithmetic and geometric sequences", "order": 4},
              {"title": "Functions – Linear, Quadratic, Hyperbolic", "description": "Graphing and interpreting functions", "order": 5},
              {"title": "Trigonometry – Basics", "description": "Trig ratios, special angles, and solving triangles", "order": 6},
              {"title": "Euclidean Geometry – Lines and Angles", "description": "Parallel lines, triangles, and quadrilaterals", "order": 7},
              {"title": "Statistics – Measures of Centre and Spread", "description": "Mean, median, mode, range, standard deviation", "order": 8},
              {"title": "Probability – Basics", "description": "Theoretical and experimental probability", "order": 9}
            ],
            "Grade 11": [
              {"title": "Algebra – Quadratic and Exponential", "description": "Solving quadratics, exponential equations, and logarithms", "order": 1},
              {"title": "Algebra – Sequences and Series", "description": "Arithmetic, geometric, and sum to infinity", "order": 2},
              {"title": "Trigonometry – Identities and Equations", "description": "Proving identities, solving trigonometric equations", "order": 3},
              {"title": "Trigonometry – Sine, Cosine, Area Rules", "description": "Application of sine, cosine, and area rules", "order": 4},
              {"title": "Functions – Advanced", "description": "Inverse functions, composite functions, and transformations", "order": 5},
              {"title": "Euclidean Geometry – Advanced", "description": "Proofs in circle geometry and similar triangles", "order": 6},
              {"title": "Statistics – Correlation and Regression", "description": "Scatter plots, least‑squares regression, and interpretation", "order": 7},
              {"title": "Finance – Simple and Compound Interest", "description": "Interest calculations and loan amortisation", "order": 8},
              {"title": "Probability – Counting Principles", "description": "Permutations, combinations, and probability theorems", "order": 9}
            ],
            "Grade 12": [
              {"title": "Calculus – Limits and Continuity", "description": "Concept of limits, continuity, and derivative definition", "order": 1},
              {"title": "Calculus – Differentiation", "description": "Rules of differentiation, tangents, and optimisation", "order": 2},
              {"title": "Calculus – Integration", "description": "Indefinite and definite integrals, area under curve", "order": 3},
              {"title": "Algebra – Sequences and Series (Application)", "description": "Application of sequences and series in finance", "order": 4},
              {"title": "Trigonometry – Compound Angles", "description": "Compound angle identities and application", "order": 5},
              {"title": "Analytical Geometry", "description": "Lines, circles, and conic sections", "order": 6},
              {"title": "Finance – Annuities and Loans", "description": "Compound interest, annuities, and loan calculations", "order": 7},
              {"title": "Probability – Advanced", "description": "Contingency tables, tree diagrams, and conditional probability", "order": 8},
              {"title": "Statistics – Distribution and Regression", "description": "Normal distribution, sampling, and confidence intervals", "order": 9}
            ]
          },
          "Mathematical Literacy": {
            "Grade 10": [
              {"title": "Numbers and Operations", "description": "Number systems, ratio, proportion, and percentage", "order": 1},
              {"title": "Financial Literacy – Personal Finance", "description": "Budgeting, simple interest, and banking", "order": 2},
              {"title": "Measurement – Length, Area, Volume", "description": "Units, conversions, and calculations", "order": 3},
              {"title": "Data Handling – Graphs and Charts", "description": "Reading and interpreting graphs, charts, and tables", "order": 4},
              {"title": "Probability – Simple", "description": "Understanding probability, tree diagrams", "order": 5},
              {"title": "Maps, Plans and Models", "description": "Scale drawings, floor plans, maps", "order": 6}
            ],
            "Grade 11": [
              {"title": "Financial Literacy – Loans and Credit", "description": "Interest, loans, hire purchase, and credit", "order": 1},
              {"title": "Measurement – Surface Area and Volume", "description": "Complex shapes, conversions, application", "order": 2},
              {"title": "Data Handling – Representation", "description": "Tables, charts, scatter plots, and interpretation", "order": 3},
              {"title": "Probability – Compound Events", "description": "Dependent and independent events, contingency tables", "order": 4},
              {"title": "Finance – Investment and Inflation", "description": "Compound interest, inflation, and real returns", "order": 5},
              {"title": "Scale and Proportion – Real World", "description": "Scale drawings, plans, and models", "order": 6}
            ],
            "Grade 12": [
              {"title": "Financial Literacy – Taxes and Budgets", "description": "Income tax, VAT, and government budgets", "order": 1},
              {"title": "Data Handling – Normal Distribution", "description": "Normal curve, mean, standard deviation", "order": 2},
              {"title": "Probability – Counting and Probability", "description": "Permutations, combinations, probability theorems", "order": 3},
              {"title": "Finance – Annuities and Loans", "description": "Compound interest, annuities, loan calculations", "order": 4},
              {"title": "Measurement – Complex Applications", "description": "Packaging, dimensions, and optimisation", "order": 5},
              {"title": "Maps and Plans – Advanced", "description": "Elevation, floor plans, and scale", "order": 6}
            ]
          },
          "Physical Sciences": {
            "Grade 10": [
              {"title": "Mechanics – Motion", "description": "Position, displacement, velocity, acceleration, and graphs", "order": 1},
              {"title": "Mechanics – Forces", "description": "Newton''s laws, friction, and equilibrium", "order": 2},
              {"title": "Waves – Sound and Light", "description": "Wave properties, reflection, refraction, and diffraction", "order": 3},
              {"title": "Electricity – Circuits", "description": "Ohm''s law, series/parallel circuits, and resistance", "order": 4},
              {"title": "Matter – Atomic Structure", "description": "Atoms, elements, periodic table, and chemical bonding", "order": 5},
              {"title": "Matter – Stoichiometry", "description": "Mole concept, molar mass, and calculations", "order": 6},
              {"title": "Energy – Forms and Conservation", "description": "Kinetic, potential, and conservation of energy", "order": 7}
            ],
            "Grade 11": [
              {"title": "Mechanics – Newton''s Laws", "description": "Applying Newton''s laws, momentum, and impulse", "order": 1},
              {"title": "Mechanics – Work, Energy, Power", "description": "Work, energy conservation, power, and efficiency", "order": 2},
              {"title": "Waves – Sound and Light", "description": "Doppler effect, electromagnetic spectrum", "order": 3},
              {"title": "Electricity – Circuits", "description": "Kirchhoff''s laws, internal resistance, and power", "order": 4},
              {"title": "Matter – Chemical Bonding", "description": "Ionic, covalent, and metallic bonding", "order": 5},
              {"title": "Matter – Stoichiometry", "description": "Molar concentration, limiting reagents, and yield", "order": 6},
              {"title": "Thermodynamics – Heat and Temperature", "description": "Heat capacity, latent heat, and phase changes", "order": 7}
            ],
            "Grade 12": [
              {"title": "Mechanics – Projectile Motion", "description": "2‑D motion, independence of horizontal/vertical motion", "order": 1},
              {"title": "Mechanics – Work‑Energy Theorem", "description": "Application of work‑energy and conservation", "order": 2},
              {"title": "Waves – Doppler Effect", "description": "Doppler effect with sound and light, applications", "order": 3},
              {"title": "Electricity – AC Circuits", "description": "Alternating current, impedance, and power factor", "order": 4},
              {"title": "Matter – Organic Chemistry", "description": "Functional groups, isomerism, and reactions", "order": 5},
              {"title": "Matter – Equilibrium", "description": "Chemical equilibrium, Le Chatelier''s principle", "order": 6},
              {"title": "Nuclear Physics – Radioactivity", "description": "Radioactive decay, half‑life, and nuclear reactions", "order": 7}
            ]
          },
          "Life Sciences": {
            "Grade 10": [
              {"title": "Cell Biology – Structure and Function", "description": "Cell organelles, cell theory, and cell transport", "order": 1},
              {"title": "DNA and Genetics", "description": "DNA structure, replication, and protein synthesis", "order": 2},
              {"title": "Human Systems – Digestive and Respiratory", "description": "Anatomy and physiology of digestion and respiration", "order": 3},
              {"title": "Ecology – Introduction", "description": "Ecosystems, energy flow, and nutrient cycling", "order": 4},
              {"title": "Plant Anatomy and Function", "description": "Structure of roots, stems, leaves, and transpiration", "order": 5},
              {"title": "Biodiversity", "description": "Classification, kingdoms, and importance of biodiversity", "order": 6}
            ],
            "Grade 11": [
              {"title": "Cell Division – Mitosis and Meiosis", "description": "Stages, differences, and significance of division", "order": 1},
              {"title": "Genetics – Inheritance", "description": "Mendelian genetics, Punnett squares, and pedigree analysis", "order": 2},
              {"title": "Human Systems – Excretion", "description": "Kidney structure, urine formation, and regulation", "order": 3},
              {"title": "Human Systems – Nervous System", "description": "Neurons, reflex arcs, brain structure, and disorders", "order": 4},
              {"title": "Biodiversity – Diversity of Life", "description": "Diversity of animals, plants, and ecological importance", "order": 5},
              {"title": "Microorganisms", "description": "Bacteria, viruses, fungi, and their roles", "order": 6}
            ],
            "Grade 12": [
              {"title": "Evolution – Natural Selection", "description": "Darwin, evidence for evolution, and speciation", "order": 1},
              {"title": "Human Reproduction", "description": "Male and female reproductive systems, gametogenesis, and cycles", "order": 2},
              {"title": "Human Systems – Endocrine", "description": "Hormones, glands, and feedback control", "order": 3},
              {"title": "Human Systems – Respiratory and Homeostasis", "description": "Gas exchange, acid‑base balance, and regulation", "order": 4},
              {"title": "Ecology and Environment", "description": "Population ecology, community dynamics, and conservation", "order": 5},
              {"title": "Genetics – DNA and Technology", "description": "DNA profiling, genetic engineering, and biotechnology", "order": 6}
            ]
          },
          "Accounting": {
            "Grade 10": [
              {"title": "Accounting Concepts", "description": "Accounting equation, double‑entry system, and basic terminology", "order": 1},
              {"title": "Journals and Ledgers", "description": "Recording transactions in journals and posting to ledgers", "order": 2},
              {"title": "Financial Statements – Income Statement", "description": "Preparing income statement for sole trader", "order": 3},
              {"title": "Financial Statements – Balance Sheet", "description": "Preparing balance sheet for sole trader", "order": 4},
              {"title": "VAT – Value Added Tax", "description": "VAT calculation, recording, and returns", "order": 5},
              {"title": "Bank Reconciliation", "description": "Bank statements, cash books, and reconciliation", "order": 6}
            ],
            "Grade 11": [
              {"title": "Adjustments and Closing Entries", "description": "Accruals, prepayments, depreciation, and closing entries", "order": 1},
              {"title": "Fixed Assets – Depreciation", "description": "Methods of depreciation and disposal of assets", "order": 2},
              {"title": "Partnerships – Accounting", "description": "Partnership agreements, capital, and current accounts", "order": 3},
              {"title": "Budgets", "description": "Cash budgets, projected income statements, and variance analysis", "order": 4},
              {"title": "Financial Analysis – Ratios", "description": "Liquidity, profitability, and solvency ratios", "order": 5},
              {"title": "Manufacturing Accounts", "description": "Cost accounting for manufacturing businesses", "order": 6}
            ],
            "Grade 12": [
              {"title": "Companies – Financial Statements", "description": "Company structure, financial statements, and notes", "order": 1},
              {"title": "Cash Flow Statements", "description": "Preparation and interpretation of cash flow statements", "order": 2},
              {"title": "Financial Analysis – Interpretation", "description": "Advanced ratio analysis, trend analysis, and limitations", "order": 3},
              {"title": "Consolidation", "description": "Basic consolidation concepts, inter‑company transactions", "order": 4},
              {"title": "Budgeting and Planning", "description": "Advanced budgeting, including capital budgeting", "order": 5},
              {"title": "Ethics in Accounting", "description": "Ethical issues, professional conduct, and corporate governance", "order": 6}
            ]
          },
          "Business Studies": {
            "Grade 10": [
              {"title": "Introduction to Business", "description": "Sectors of the economy, business types, and forms of ownership", "order": 1},
              {"title": "Entrepreneurship", "description": "Entrepreneurial skills, opportunities, and business plan", "order": 2},
              {"title": "Marketing – Basics", "description": "Market research, 4Ps, and consumer behaviour", "order": 3},
              {"title": "Human Resources – Introduction", "description": "Recruitment, selection, and employment", "order": 4},
              {"title": "Financial Management – Introduction", "description": "Business finance, budgeting, and cash flow", "order": 5},
              {"title": "Business Ethics and Social Responsibility", "description": "Ethics, corporate social responsibility, and legal compliance", "order": 6}
            ],
            "Grade 11": [
              {"title": "Business Environments", "description": "Micro, market, and macro environments", "order": 1},
              {"title": "Marketing – Strategies", "description": "Segmentation, targeting, positioning, and marketing mix", "order": 2},
              {"title": "Human Resources – Management", "description": "Staffing, training, and labour relations", "order": 3},
              {"title": "Financial Management – Advanced", "description": "Financial statements, analysis, and interpretation", "order": 4},
              {"title": "Business Management Functions", "description": "Planning, organising, leading, and controlling", "order": 5},
              {"title": "Corporate Governance", "description": "Shareholders, directors, and governance principles", "order": 6}
            ],
            "Grade 12": [
              {"title": "Business Strategy", "description": "Strategic planning, SWOT, and Porter''s forces", "order": 1},
              {"title": "Business Operations – Advanced", "description": "Operations management, quality, and supply chain", "order": 2},
              {"title": "Finance – Advanced Topics", "description": "Investment decisions, sources of finance, and risk", "order": 3},
              {"title": "Human Resources – Advanced", "description": "Industrial relations, labour law, and dispute resolution", "order": 4},
              {"title": "Innovation and Entrepreneurship", "description": "Innovation, intrapreneurship, and business growth", "order": 5},
              {"title": "Business Ethics and Sustainability", "description": "Ethical dilemmas, sustainability, and corporate responsibility", "order": 6}
            ]
          },
          "Economics": {
            "Grade 10": [
              {"title": "Basic Concepts", "description": "Scarcity, choice, opportunity cost, and economic systems", "order": 1},
              {"title": "Demand and Supply", "description": "Market equilibrium, shifts, and elasticity", "order": 2},
              {"title": "Circular Flow and Gross Domestic Product", "description": "Economic aggregates, GDP, and measurements", "order": 3},
              {"title": "Money and Banking", "description": "Functions of money, banking systems, and instruments", "order": 4},
              {"title": "International Trade", "description": "Absolute and comparative advantage, tariffs, and quotas", "order": 5},
              {"title": "Government and the Economy", "description": "Public sector, fiscal and monetary policy basics", "order": 6}
            ],
            "Grade 11": [
              {"title": "Microeconomics – Consumers", "description": "Consumer theory, utility, and demand", "order": 1},
              {"title": "Microeconomics – Producers", "description": "Production, costs, and profit maximisation", "order": 2},
              {"title": "Market Structures", "description": "Perfect competition, monopoly, oligopoly, and monopolistic competition", "order": 3},
              {"title": "Macroeconomics – National Income", "description": "National income accounting, GDP, GNP, and NI", "order": 4},
              {"title": "Macroeconomics – Unemployment and Inflation", "description": "Measurement, causes, and effects", "order": 5},
              {"title": "Economic Growth and Development", "description": "Growth indicators, development strategies", "order": 6}
            ],
            "Grade 12": [
              {"title": "International Economics", "description": "Globalisation, trade agreements, and balance of payments", "order": 1},
              {"title": "Monetary and Fiscal Policy", "description": "Central bank, interest rates, taxation, and government spending", "order": 2},
              {"title": "Microeconomic Policy", "description": "Regulation, antitrust, and public goods", "order": 3},
              {"title": "Macroeconomic Issues", "description": "Economic cycles, stagflation, and policy responses", "order": 4},
              {"title": "Development Economics", "description": "Poverty, inequality, and sustainable development", "order": 5},
              {"title": "Contemporary Economic Issues", "description": "Current challenges and policy debates", "order": 6}
            ]
          },
          "Geography": {
            "Grade 10": [
              {"title": "Physical Geography – Atmosphere", "description": "Weather, climate, and atmospheric processes", "order": 1},
              {"title": "Physical Geography – Lithosphere", "description": "Earth structure, plate tectonics, and landforms", "order": 2},
              {"title": "Human Geography – Population", "description": "Population distribution, density, and dynamics", "order": 3},
              {"title": "Human Geography – Urbanisation", "description": "Urban growth, development, and urbanisation", "order": 4},
              {"title": "Geographical Skills – Maps and GIS", "description": "Map reading, GIS, and spatial analysis", "order": 5},
              {"title": "Environmental Sustainability", "description": "Environmental issues, conservation, and sustainability", "order": 6}
            ],
            "Grade 11": [
              {"title": "Physical Geography – Geomorphology", "description": "Fluvial processes, drainage patterns, and landforms", "order": 1},
              {"title": "Physical Geography – Climatology", "description": "Air masses, cyclones, and climate change", "order": 2},
              {"title": "Human Geography – Economic Geography", "description": "Agriculture, industry, and tertiary sectors", "order": 3},
              {"title": "Human Geography – Development Geography", "description": "Development indicators, inequality, and strategies", "order": 4},
              {"title": "GIS and Cartography", "description": "Advanced GIS, remote sensing, and map interpretation", "order": 5},
              {"title": "Environmental Management", "description": "Environmental impact assessment and management", "order": 6}
            ],
            "Grade 12": [
              {"title": "Physical Geography – Hydrology", "description": "Fluvial systems, groundwater, and management", "order": 1},
              {"title": "Physical Geography – Geomorphology", "description": "Rivers, slopes, and mass movements", "order": 2},
              {"title": "Human Geography – Economic Geography", "description": "Industrial development, trade, and globalisation", "order": 3},
              {"title": "Human Geography – Urban Geography", "description": "Urban structure, housing, and sustainability", "order": 4},
              {"title": "Environmental Management – Global Challenges", "description": "Climate change, resource depletion, and responses", "order": 5},
              {"title": "Applied Geography", "description": "Case studies, projects, and problem-solving", "order": 6}
            ]
          },
          "History": {
            "Grade 10": [
              {"title": "Introduction to History", "description": "Historical method, sources, and timeline", "order": 1},
              {"title": "Ancient and Medieval Civilisations", "description": "Egypt, Greece, Rome, and African empires", "order": 2},
              {"title": "Colonisation and Resistance", "description": "Colonial expansion, resistance, and independence movements", "order": 3},
              {"title": "Africa and the Slave Trade", "description": "Trans‑Atlantic slave trade and its impact", "order": 4},
              {"title": "The Industrial Revolution", "description": "Technological and social changes, consequences", "order": 5},
              {"title": "South Africa – The Colony", "description": "Early colonial society and the Union of South Africa", "order": 6}
            ],
            "Grade 11": [
              {"title": "World War I and its Aftermath", "description": "Causes, major events, and peace treaties", "order": 1},
              {"title": "World War II and the Holocaust", "description": "Causes, major events, and humanitarian impact", "order": 2},
              {"title": "The Rise of Nationalism", "description": "Nationalism in Africa, Asia, and Europe", "order": 3},
              {"title": "The Cold War", "description": "Ideological conflict, major events, and consequences", "order": 4},
              {"title": "Decolonisation in Africa", "description": "Independence movements and post‑colonial challenges", "order": 5},
              {"title": "Apartheid in South Africa", "description": "Rise, institutionalisation, and resistance", "order": 6}
            ],
            "Grade 12": [
              {"title": "The Struggle for Freedom in South Africa", "description": "Key events, organisations, and leaders", "order": 1},
              {"title": "The Transition to Democracy", "description": "Negotiations, constitution, and nation‑building", "order": 2},
              {"title": "Globalisation and its Impact", "description": "Economic, cultural, and political effects", "order": 3},
              {"title": "Conflict and Resolution", "description": "Case studies of conflict and peacebuilding", "order": 4},
              {"title": "The Contemporary World", "description": "Current challenges, climate, and inequality", "order": 5},
              {"title": "Historical Skills – Advanced", "description": "Source analysis, interpretation, and essays", "order": 6}
            ]
          },
          "Information Technology": {
            "Grade 10": [
              {"title": "Introduction to Computers", "description": "Hardware, software, and operating systems", "order": 1},
              {"title": "Programming – Fundamentals", "description": "Variables, data types, and basic logic", "order": 2},
              {"title": "Algorithms and Problem Solving", "description": "Algorithm design, flowcharts, and pseudocode", "order": 3},
              {"title": "Data Structures – Basics", "description": "Arrays, lists, and simple data structures", "order": 4},
              {"title": "Networking – Fundamentals", "description": "Network types, protocols, and topologies", "order": 5},
              {"title": "Databases – Introduction", "description": "Relational databases, queries, and SQL", "order": 6}
            ],
            "Grade 11": [
              {"title": "Programming – Advanced", "description": "Functions, modularisation, and debugging", "order": 1},
              {"title": "Object‑Oriented Programming", "description": "Classes, objects, and inheritance", "order": 2},
              {"title": "Data Structures – Advanced", "description": "Stacks, queues, and linked lists", "order": 3},
              {"title": "Algorithms – Sorting and Searching", "description": "Sorting and searching techniques", "order": 4},
              {"title": "System Development Life Cycle", "description": "Analysis, design, implementation, testing", "order": 5},
              {"title": "Data Communications", "description": "Transmission media, protocols, and security", "order": 6}
            ],
            "Grade 12": [
              {"title": "Advanced Programming", "description": "Graphical user interfaces, event‑driven programming", "order": 1},
              {"title": "Software Engineering", "description": "Project management, version control, and documentation", "order": 2},
              {"title": "Advanced Databases", "description": "Normalisation, indexing, and transactions", "order": 3},
              {"title": "Web Development – Introduction", "description": "HTML, CSS, JavaScript, and web frameworks", "order": 4},
              {"title": "Cybersecurity", "description": "Threats, protection, and ethical hacking", "order": 5},
              {"title": "Artificial Intelligence and Emerging Technologies", "description": "AI, machine learning, and future trends", "order": 6}
            ]
          },
          "Computer Applications Technology (CAT)": {
            "Grade 10": [
              {"title": "Introduction to Computers – Office Applications", "description": "MS Office, file management, and basic use", "order": 1},
              {"title": "Word Processing", "description": "Document formatting, tables, and mail merge", "order": 2},
              {"title": "Spreadsheets – Basics", "description": "Formulas, functions, and charts", "order": 3},
              {"title": "Presentations", "description": "Creating presentations, animations, and effects", "order": 4},
              {"title": "Internet and Email", "description": "Email etiquette, web browsing, and online tools", "order": 5},
              {"title": "Computer Ethics and Security", "description": "Online safety, ethics, and data protection", "order": 6}
            ],
            "Grade 11": [
              {"title": "Word Processing – Advanced", "description": "Templates, styles, and automation", "order": 1},
              {"title": "Spreadsheets – Advanced", "description": "Complex formulas, macros, and data analysis", "order": 2},
              {"title": "Databases", "description": "Database design, queries, and forms", "order": 3},
              {"title": "Web Development – Basic", "description": "HTML, CSS, and web design", "order": 4},
              {"title": "Computer Architecture", "description": "CPU, memory, storage, and I/O", "order": 5},
              {"title": "Social and Ethical Issues", "description": "E‑waste, cybercrime, and digital divide", "order": 6}
            ],
            "Grade 12": [
              {"title": "Advanced Word Processing", "description": "Automation, forms, and integration", "order": 1},
              {"title": "Advanced Spreadsheets", "description": "Advanced macros, data modelling, and pivot tables", "order": 2},
              {"title": "Advanced Database", "description": "Normalisation, queries, and reporting", "order": 3},
              {"title": "Web Development – Advanced", "description": "JavaScript, forms, and interactivity", "order": 4},
              {"title": "Systems Analysis and Design", "description": "SDLC, feasibility, and prototyping", "order": 5},
              {"title": "Current Trends in Computing", "description": "Cloud computing, big data, and AI", "order": 6}
            ]
          },
          "Engineering Graphics and Design (EGD)": {
            "Grade 10": [
              {"title": "Introduction to Engineering Drawing", "description": "Drawing instruments, scales, and standards", "order": 1},
              {"title": "Orthographic Projection", "description": "First‑angle projection, views, and hidden details", "order": 2},
              {"title": "Isometric Drawing", "description": "3‑D drawing techniques and isometric projection", "order": 3},
              {"title": "Sectioning", "description": "Section views, cross‑section, and conventions", "order": 4},
              {"title": "Dimensioning", "description": "Rules, tolerances, and dimensioning methods", "order": 5},
              {"title": "Geometric Construction", "description": "Constructing lines, circles, and polygons", "order": 6}
            ],
            "Grade 11": [
              {"title": "Advanced Orthographic", "description": "Complicated parts, assembly drawings", "order": 1},
              {"title": "Engineering Components", "description": "Shafts, gears, and springs", "order": 2},
              {"title": "Pictorial Projection", "description": "Oblique and perspective drawings", "order": 3},
              {"title": "Practical Design", "description": "Design processes, specifications, and constraints", "order": 4},
              {"title": "CAD – Introduction", "description": "Computer‑aided design tools and basic commands", "order": 5},
              {"title": "Standards and Quality", "description": "ISO standards, quality control, and inspection", "order": 6}
            ],
            "Grade 12": [
              {"title": "Advanced CAD", "description": "3‑D modelling, rendering, and simulation", "order": 1},
              {"title": "Design Project", "description": "Capstone design project, concept to prototype", "order": 2},
              {"title": "Systems and Mechanisms", "description": "Mechanical systems, linkages, and gears", "order": 3},
              {"title": "Structural Design", "description": "Structural analysis, load calculations, and design", "order": 4},
              {"title": "Manufacturing Processes", "description": "Casting, forging, machining, and CNC", "order": 5},
              {"title": "Professional Practice", "description": "Ethics, safety, and project management", "order": 6}
            ]
          },
          "Life Orientation": {
            "Grade 10": [
              {"title": "Personal Development", "description": "Self‑concept, goal setting, and time management", "order": 1},
              {"title": "Health and Wellness", "description": "Nutrition, exercise, and mental health", "order": 2},
              {"title": "Citizenship and Democracy", "description": "Rights, responsibilities, and voting", "order": 3},
              {"title": "Study Skills", "description": "Learning strategies, note‑taking, and exams", "order": 4},
              {"title": "Relationships", "description": "Communication, conflict resolution, and peer pressure", "order": 5},
              {"title": "Career Development", "description": "Career choices, skills, and job market", "order": 6}
            ],
            "Grade 11": [
              {"title": "Personal Development – Advanced", "description": "Emotional intelligence, resilience, and mindfulness", "order": 1},
              {"title": "Social Issues", "description": "Poverty, discrimination, and social justice", "order": 2},
              {"title": "Democracy and Human Rights", "description": "South African constitution, human rights, and advocacy", "order": 3},
              {"title": "Community Engagement", "description": "Service learning, volunteering, and community projects", "order": 4},
              {"title": "Health and Safety", "description": "First aid, safety, and healthy lifestyles", "order": 5},
              {"title": "Career and Further Education", "description": "Tertiary study options, bursaries, and planning", "order": 6}
            ],
            "Grade 12": [
              {"title": "Life Skills and Resilience", "description": "Stress management, decision‑making, and adaptability", "order": 1},
              {"title": "Social Responsibility", "description": "Ethical behaviour, environmental responsibility, and sustainability", "order": 2},
              {"title": "Citizenship and Governance", "description": "Active citizenship, participation in democracy", "order": 3},
              {"title": "Entrepreneurship and Employment", "description": "Small business, job readiness, and entrepreneurship", "order": 4},
              {"title": "Physical Activity and Health", "description": "Fitness, exercise, and long‑term health", "order": 5},
              {"title": "Career Planning", "description": "Portfolio, interviews, and career pathways", "order": 6}
            ]
          },
          "Tourism": {
            "Grade 10": [
              {"title": "Introduction to Tourism", "description": "Tourism industry, sectors, and importance", "order": 1},
              {"title": "Tourism Geography", "description": "Destinations, climate, and map reading", "order": 2},
              {"title": "Accommodation and Catering", "description": "Types of accommodation, restaurants, and service", "order": 3},
              {"title": "Tourist Attractions", "description": "Natural, cultural, and historical attractions", "order": 4},
              {"title": "Transport in Tourism", "description": "Air, land, and sea transport", "order": 5},
              {"title": "Tourism and the Environment", "description": "Sustainable tourism, eco‑tourism, and impact", "order": 6}
            ],
            "Grade 11": [
              {"title": "Tourism Marketing", "description": "Marketing strategies, promotion, and branding", "order": 1},
              {"title": "Tourist Services", "description": "Guiding, tour operations, and customer service", "order": 2},
              {"title": "Business of Tourism", "description": "Entrepreneurship, business plans, and feasibility", "order": 3},
              {"title": "Tourism Destinations – Advanced", "description": "Regional study, cultural awareness", "order": 4},
              {"title": "Tourism and Development", "description": "Economic development, job creation, and poverty reduction", "order": 5},
              {"title": "Travel Documentation", "description": "Passports, visas, and travel insurance", "order": 6}
            ],
            "Grade 12": [
              {"title": "Strategic Tourism", "description": "Planning, policy, and destination management", "order": 1},
              {"title": "Tourism and Sustainability", "description": "Sustainable development, responsible tourism", "order": 2},
              {"title": "Innovation in Tourism", "description": "Digital technology, social media, and trends", "order": 3},
              {"title": "Crisis Management in Tourism", "description": "Risk, disaster preparedness, and recovery", "order": 4},
              {"title": "Tourism and the Global Economy", "description": "Impact of globalisation, trade, and finance", "order": 5},
              {"title": "Capstone Project", "description": "Tourism proposal or business plan", "order": 6}
            ]
          },
          "Consumer Studies": {
            "Grade 10": [
              {"title": "Consumer Behaviour", "description": "Decision‑making, needs, and wants", "order": 1},
              {"title": "Budgeting and Financial Planning", "description": "Personal finance, budgeting, and saving", "order": 2},
              {"title": "Nutrition and Healthy Eating", "description": "Balanced diet, food groups, and meal planning", "order": 3},
              {"title": "Clothing and Textiles", "description": "Fabric selection, care, and fashion", "order": 4},
              {"title": "Housing and Interior Design", "description": "Housing types, décor, and functionality", "order": 5},
              {"title": "Consumer Rights and Protection", "description": "Consumer rights, consumer protection legislation", "order": 6}
            ],
            "Grade 11": [
              {"title": "Advanced Consumer Behaviour", "description": "Impulse buying, marketing influences, and brand loyalty", "order": 1},
              {"title": "Financial Management", "description": "Credit, loans, and investment decisions", "order": 2},
              {"title": "Food and Nutrition Science", "description": "Food chemistry, preservation, and safety", "order": 3},
              {"title": "Textiles – Advanced", "description": "Natural and synthetic fibres, fabric properties", "order": 4},
              {"title": "Home Management", "description": "Household management, budgeting, and organisation", "order": 5},
              {"title": "Consumer Law and Ethics", "description": "Laws, redress, and ethical consumption", "order": 6}
            ],
            "Grade 12": [
              {"title": "Strategic Consumerism", "description": "Consumer advocacy, sustainable consumption", "order": 1},
              {"title": "Personal Finance – Advanced", "description": "Retirement planning, insurance, and estate planning", "order": 2},
              {"title": "Food and Nutrition – Application", "description": "Special diets, menu planning, and nutrition science", "order": 3},
              {"title": "Interior Design – Advanced", "description": "Space planning, lighting, and design trends", "order": 4},
              {"title": "Consumerism and Society", "description": "Social issues, ethical consumption, and activism", "order": 5},
              {"title": "Research Project", "description": "Consumer studies research project", "order": 6}
            ]
          },
          "Visual Arts": {
            "Grade 10": [
              {"title": "Elements of Art", "description": "Line, shape, form, value, colour, space", "order": 1},
              {"title": "Principles of Design", "description": "Balance, contrast, emphasis, rhythm, and composition", "order": 2},
              {"title": "Drawing Techniques", "description": "Line drawing, shading, perspective, and portraiture", "order": 3},
              {"title": "Painting Techniques", "description": "Watercolour, acrylic, oil, and mixed media", "order": 4},
              {"title": "Art History – Introduction", "description": "Major art movements and artists", "order": 5},
              {"title": "Sculpture and 3‑D", "description": "Modeling, carving, and construction", "order": 6}
            ],
            "Grade 11": [
              {"title": "Advanced Drawing", "description": "Life drawing, expressive techniques, and composition", "order": 1},
              {"title": "Advanced Painting", "description": "Colour theory, glazing, and texture", "order": 2},
              {"title": "Printmaking", "description": "Linocut, etching, and screen printing", "order": 3},
              {"title": "Art History – Modernism", "description": "Impressionism, Cubism, and Surrealism", "order": 4},
              {"title": "Sculpture – Advanced", "description": "Installation and environmental art", "order": 5},
              {"title": "Developing a Portfolio", "description": "Selecting and presenting work", "order": 6}
            ],
            "Grade 12": [
              {"title": "Personal Expression and Style", "description": "Developing a personal artistic voice", "order": 1},
              {"title": "Contemporary Art Practice", "description": "Current trends, conceptual art, and performance", "order": 2},
              {"title": "Art History – Contemporary", "description": "Post‑modernism, globalisation, and new media", "order": 3},
              {"title": "Studio Practice", "description": "Independent studio work and critique", "order": 4},
              {"title": "Exhibition and Presentation", "description": "Installing and presenting work", "order": 5},
              {"title": "Capstone Project", "description": "Final project, portfolio, and artist statement", "order": 6}
            ]
          },
          "Music": {
            "Grade 10": [
              {"title": "Music Theory – Fundamentals", "description": "Notes, scales, intervals, and key signatures", "order": 1},
              {"title": "Aural Skills", "description": "Pitch, rhythm, and interval recognition", "order": 2},
              {"title": "Practical Musicianship – Instruments", "description": "Instrument techniques and ensemble", "order": 3},
              {"title": "Music History – Western Art", "description": "Baroque, Classical, Romantic, Modern", "order": 4},
              {"title": "Composition – Basics", "description": "Melody, harmony, and simple form", "order": 5},
              {"title": "Music Technology – Introduction", "description": "Recording software, MIDI, and digital audio", "order": 6}
            ],
            "Grade 11": [
              {"title": "Advanced Music Theory", "description": "Harmony, counterpoint, and analysis", "order": 1},
              {"title": "Aural – Advanced", "description": "Dictation, transcription, and sight‑singing", "order": 2},
              {"title": "Performance – Solo and Ensemble", "description": "Interpretation, technique, and stage presence", "order": 3},
              {"title": "Music History – African and World", "description": "African music traditions, jazz, and world music", "order": 4},
              {"title": "Composition – Advanced", "description": "Songwriting, arranging, and orchestration", "order": 5},
              {"title": "Music Technology – Production", "description": "Recording, editing, and mixing", "order": 6}
            ],
            "Grade 12": [
              {"title": "Analysis and Criticism", "description": "Critical listening and music analysis", "order": 1},
              {"title": "Performance – Mastery", "description": "Recital preparation and performance", "order": 2},
              {"title": "Composition and Arranging", "description": "Large‑scale composition and arranging", "order": 3},
              {"title": "Music Technology – Advanced", "description": "Studio recording, production, and mastering", "order": 4},
              {"title": "Music in Society", "description": "Music and social change, psychology of music", "order": 5},
              {"title": "Final Project", "description": "Composition, performance, or research", "order": 6}
            ]
          },
          "Dramatic Arts": {
            "Grade 10": [
              {"title": "Foundations of Drama", "description": "Elements of drama, theatre conventions, and genres", "order": 1},
              {"title": "Acting Technique – Basics", "description": "Voice, movement, and characterisation", "order": 2},
              {"title": "Improvisation", "description": "Spontaneity, storytelling, and improvisation", "order": 3},
              {"title": "Theatre History – Introduction", "description": "Ancient Greek to Renaissance theatre", "order": 4},
              {"title": "Play Analysis", "description": "Reading, analysing, and interpreting plays", "order": 5},
              {"title": "Technical Theatre", "description": "Stagecraft, lighting, and sound basics", "order": 6}
            ],
            "Grade 11": [
              {"title": "Advanced Acting", "description": "Method acting, character development, and style", "order": 1},
              {"title": "Scriptwriting", "description": "Writing monologues and short plays", "order": 2},
              {"title": "Directing", "description": "Blocking, staging, and communicating with actors", "order": 3},
              {"title": "Theatre History – Modern", "description": "Modern and contemporary theatre", "order": 4},
              {"title": "Physical Theatre and Movement", "description": "Commedia dell''arte, clowning, and physical expression", "order": 5},
              {"title": "Production Project", "description": "Rehearsal and performance of a short piece", "order": 6}
            ],
            "Grade 12": [
              {"title": "Advanced Performance", "description": "Solo and ensemble performance", "order": 1},
              {"title": "Directing and Design", "description": "Concept, design, and direction of a production", "order": 2},
              {"title": "Playwrighting", "description": "Writing a one‑act play", "order": 3},
              {"title": "Theatre and Society", "description": "Theatre as social commentary, protest and change", "order": 4},
              {"title": "Production and Management", "description": "Producing, marketing, and stage management", "order": 5},
              {"title": "Capstone Production", "description": "Full production, from script to performance", "order": 6}
            ]
          },
          "Religion Studies": {
            "Grade 10": [
              {"title": "Introduction to Religion", "description": "Defining religion, worldviews, and spirituality", "order": 1},
              {"title": "World Religions – Overview", "description": "Major religions: Christianity, Islam, Hinduism, Buddhism, Judaism, Traditional African Religions", "order": 2},
              {"title": "Sacred Texts", "description": "Bible, Quran, Vedas, and other sacred writings", "order": 3},
              {"title": "Ritual and Worship", "description": "Practices, ceremonies, and worship", "order": 4},
              {"title": "Ethics and Morality", "description": "Religious ethics and moral principles", "order": 5},
              {"title": "Religion in South Africa", "description": "Religious diversity, freedom, and tension", "order": 6}
            ],
            "Grade 11": [
              {"title": "Comparative Religion", "description": "Comparing doctrines, practices, and beliefs", "order": 1},
              {"title": "Religion and Society", "description": "Role of religion in social change and conflict", "order": 2},
              {"title": "Religion and Politics", "description": "Religious influence on politics and law", "order": 3},
              {"title": "Religious Ethics – Applied", "description": "Bioethics, war, and environmental ethics", "order": 4},
              {"title": "Interfaith Dialogue", "description": "Understanding, tolerance, and cooperation", "order": 5},
              {"title": "Sacred Art and Architecture", "description": "Symbols, iconography, and sacred spaces", "order": 6}
            ],
            "Grade 12": [
              {"title": "Contemporary Religious Issues", "description": "Secularism, new religious movements, and fundamentalism", "order": 1},
              {"title": "Religion and Human Rights", "description": "Rights, gender, and equality", "order": 2},
              {"title": "Religion and Ecology", "description": "Religious perspectives on environmentalism", "order": 3},
              {"title": "Religious Pluralism", "description": "Living with religious diversity", "order": 4},
              {"title": "Research Project", "description": "Independent research on a religious topic", "order": 5},
              {"title": "Spirituality in the Modern World", "description": "Spirituality, mindfulness, and wellbeing", "order": 6}
            ]
          },
          "Hospitality Studies": {
            "Grade 10": [
              {"title": "Introduction to Hospitality", "description": "The hospitality industry, career paths, and ethics", "order": 1},
              {"title": "Food Safety and Hygiene", "description": "HACCP, personal hygiene, and food handling", "order": 2},
              {"title": "Baking and Pastry – Basics", "description": "Bread, cakes, and basic pastry", "order": 3},
              {"title": "Cooking Techniques – Fundamentals", "description": "Boiling, frying, roasting, grilling, and steaming", "order": 4},
              {"title": "Front Office and Housekeeping", "description": "Reception, reservations, and room care", "order": 5},
              {"title": "Customer Service", "description": "Communication, problem‑solving, and satisfaction", "order": 6}
            ],
            "Grade 11": [
              {"title": "Advanced Baking and Pastry", "description": "Puff pastry, choux, and laminating", "order": 1},
              {"title": "International Cuisine", "description": "Asian, European, and African cuisine", "order": 2},
              {"title": "Menu Planning and Design", "description": "Balanced menus, dietary requirements, and aesthetics", "order": 3},
              {"title": "Food and Beverage Management", "description": "Costing, inventory, and stock control", "order": 4},
              {"title": "Event Management", "description": "Planning and executing events", "order": 5},
              {"title": "Hospitality Law", "description": "Licensing, labour law, and liability", "order": 6}
            ],
            "Grade 12": [
              {"title": "Gourmet Cooking and Plating", "description": "Advanced techniques, presentation, and gastronomy", "order": 1},
              {"title": "Wine and Beverage Studies", "description": "Wine selection, service, and pairing", "order": 2},
              {"title": "Business Management in Hospitality", "description": "Budgeting, marketing, and entrepreneurship", "order": 3},
              {"title": "Sustainable Practices", "description": "Waste management, sustainability, and green practices", "order": 4},
              {"title": "Capstone Project", "description": "Design a menu/event or business plan", "order": 5},
              {"title": "Industry Placement", "description": "Work experience and reflection", "order": 6}
            ]
          },
          "Design": {
            "Grade 10": [
              {"title": "Design Principles", "description": "Balance, contrast, emphasis, rhythm, and harmony", "order": 1},
              {"title": "Colour Theory", "description": "Colour wheel, psychology, and application", "order": 2},
              {"title": "Typography", "description": "Typefaces, hierarchy, and communication", "order": 3},
              {"title": "Graphic Design – Basics", "description": "Layout, composition, and visual communication", "order": 4},
              {"title": "Product Design – Introduction", "description": "Design thinking, sketching, and prototyping", "order": 5},
              {"title": "History of Design", "description": "Major movements: Bauhaus, Art Deco, Modernism", "order": 6}
            ],
            "Grade 11": [
              {"title": "Advanced Graphic Design", "description": "Branding, logo design, and packaging", "order": 1},
              {"title": "User Interface / User Experience", "description": "UI/UX fundamentals, wireframing, and testing", "order": 2},
              {"title": "Environmental Design", "description": "Interior and architectural design", "order": 3},
              {"title": "Design for Social Impact", "description": "Design for social causes, accessibility", "order": 4},
              {"title": "Digital Design Tools", "description": "Adobe Creative Suite, prototyping tools", "order": 5},
              {"title": "Design Research", "description": "User research, interviews, and surveys", "order": 6}
            ],
            "Grade 12": [
              {"title": "Advanced UI/UX", "description": "Prototyping, usability testing, and interaction design", "order": 1},
              {"title": "Brand Strategy", "description": "Brand positioning, storytelling, and market research", "order": 2},
              {"title": "Design Portfolio", "description": "Creating and presenting a professional portfolio", "order": 3},
              {"title": "Design Studio Practice", "description": "Collaborative projects and client briefs", "order": 4},
              {"title": "Design Entrepreneurship", "description": "Freelancing, pricing, and business models", "order": 5},
              {"title": "Capstone Project", "description": "Final design project from concept to execution", "order": 6}
            ]
          },
          "Afrikaans Home Language": {
            "Grade 10": [
              {"title": "Taalvaardighede – Grammatika", "description": "Woordorde, tye, voorsetsels, en lidwoorde", "order": 1},
              {"title": "Taalvaardighede – Leesbegrip", "description": "Begripstoets, vrae, en interpretasie", "order": 2},
              {"title": "Letterkunde – Poësie", "description": "Gedigte, metrum, en analise", "order": 3},
              {"title": "Letterkunde – Prosa", "description": "Kortverhale, temas, en karakterbeelding", "order": 4},
              {"title": "Skryfvaardighede", "description": "Opstelle, transaksionele skryfwerk, en briewe", "order": 5},
              {"title": "Mondelinge Kommunikasie", "description": "Praat, aanbiedings, en debat", "order": 6}
            ],
            "Grade 11": [
              {"title": "Taalvaardighede – Gevorderd", "description": "Idiome, sinsneë, en stylfigure", "order": 1},
              {"title": "Letterkunde – Drama", "description": "Toneelstukke, dialoog, en opvoering", "order": 2},
              {"title": "Letterkunde – Poësie (Gevorderd)", "description": "Diepgaande gediganalise en interpretasie", "order": 3},
              {"title": "Skryfvaardighede – Gevorderd", "description": "Opstelle, outobiografie, en kritiese essays", "order": 4},
              {"title": "Mondelinge Taalvaardighede", "description": "Gesprekvoering, argumentasie, en voorbereide praat", "order": 5},
              {"title": "Literêre Teorie", "description": "Strukturalisme, postkolonialisme, en feminisme", "order": 6}
            ],
            "Grade 12": [
              {"title": "Taalvaardighede – Meesterskap", "description": "Taalgebruik, register, en styl", "order": 1},
              {"title": "Letterkunde – Romans", "description": "Langtekste, tematiese analise, en kritiese interpretasie", "order": 2},
              {"title": "Letterkunde – Poësie (Meesterskap)", "description": "Gediganalise, kommentaar, en kreatiewe response", "order": 3},
              {"title": "Skryfvaardighede – Meesterskap", "description": "Opstelle, rubrieke, en argumentatiewe skryfwerk", "order": 4},
              {"title": "Mondelinge Eksamen", "description": "Voorbereide praat, onderhoud, en debat", "order": 5},
              {"title": "Literêre Kritiek", "description": "Kritiese teorieë en toepassing", "order": 6}
            ]
          },
          "Afrikaans First Additional Language": {
            "Grade 10": [
              {"title": "Basiese Taalvaardighede", "description": "Woordorde, tye, voorsetsels, en idioom", "order": 1},
              {"title": "Leesbegrip", "description": "Begripstoets, vrae, en verbande", "order": 2},
              {"title": "Poësie en Prosa", "description": "Kort gedigte en stories, met eenvoudige analise", "order": 3},
              {"title": "Skryfwerk", "description": "Opstelle, briewe, en eenvoudige transaksionele tekste", "order": 4},
              {"title": "Mondelinge Kommunikasie", "description": "Praat, aanbiedings, en dialoog", "order": 5},
              {"title": "Taalstrukture", "description": "Sinne, frases, en leestekens", "order": 6}
            ],
            "Grade 11": [
              {"title": "Taalvaardighede (Gevorderd)", "description": "Idiome, metafore, en samenstellings", "order": 1},
              {"title": "Begrip en Ontleding", "description": "Diepgaande leesbegrip en analise", "order": 2},
              {"title": "Letterkunde – Drama en Poësie", "description": "Toneelstukke en dieper gedigte", "order": 3},
              {"title": "Skryfvaardighede", "description": "Argumentatiewe opstelle, resensies, en essays", "order": 4},
              {"title": "Mondelinge Vaardighede", "description": "Voorbereide en onvoorbereide praat", "order": 5},
              {"title": "Taal in Konteks", "description": "Pragmatiek en sosiale taalgebruik", "order": 6}
            ],
            "Grade 12": [
              {"title": "Taalbeheersing", "description": "Verfynde taalgebruik, register, en styl", "order": 1},
              {"title": "Letterkunde – Romans en Drama", "description": "Langtekste, tematiese ontleding, en kritiese response", "order": 2},
              {"title": "Poësie – Gevorderd", "description": "Diepgaande gediganalise", "order": 3},
              {"title": "Skryfwerk – Gevorderd", "description": "Essays, rubrieke, en kreatiewe skryfwerk", "order": 4},
              {"title": "Mondelinge Eksamen", "description": "Voorbereide praat, onderhoud, en debat", "order": 5},
              {"title": "Literêre Teorie", "description": "Inleiding tot literêre kritiek", "order": 6}
            ]
          },
          "English Home Language": {
            "Grade 10": [
              {"title": "Language Skills – Grammar", "description": "Parts of speech, tenses, and sentence structure", "order": 1},
              {"title": "Language Skills – Vocabulary", "description": "Word families, synonyms, antonyms, and idioms", "order": 2},
              {"title": "Literature – Poetry", "description": "Reading, analysing, and interpreting poems", "order": 3},
              {"title": "Literature – Prose", "description": "Short stories, themes, and character analysis", "order": 4},
              {"title": "Writing Skills", "description": "Essay writing, transactional writing, and letters", "order": 5},
              {"title": "Oral Communication", "description": "Speaking, presentations, and debates", "order": 6}
            ],
            "Grade 11": [
              {"title": "Language – Advanced", "description": "Complex sentence structures, stylistic devices", "order": 1},
              {"title": "Literature – Drama", "description": "Play analysis, dialogue, and performance", "order": 2},
              {"title": "Literature – Poetry (Advanced)", "description": "In‑depth analysis and critical response", "order": 3},
              {"title": "Writing – Advanced", "description": "Essays, reviews, and creative writing", "order": 4},
              {"title": "Oral – Advanced", "description": "Prepared speeches, interviews, and argumentation", "order": 5},
              {"title": "Literary Theory", "description": "Introduction to critical theory", "order": 6}
            ],
            "Grade 12": [
              {"title": "Language Mastery", "description": "Style, register, and language analysis", "order": 1},
              {"title": "Literature – Novels", "description": "Extended texts, thematic analysis, and criticism", "order": 2},
              {"title": "Literature – Poetry (Mastery)", "description": "Deep analysis and comparative essays", "order": 3},
              {"title": "Writing Mastery", "description": "Essays, arguments, and creative pieces", "order": 4},
              {"title": "Oral Examination", "description": "Prepared speech, interview, and debate", "order": 5},
              {"title": "Literary Criticism", "description": "Applying critical theories to texts", "order": 6}
            ]
          },
          "English First Additional Language": {
            "Grade 10": [
              {"title": "Basic Language Skills", "description": "Parts of speech, tenses, and common vocabulary", "order": 1},
              {"title": "Reading Comprehension", "description": "Understanding and answering questions", "order": 2},
              {"title": "Literature – Simple Texts", "description": "Short stories and poems, basic analysis", "order": 3},
              {"title": "Writing – Basics", "description": "Simple essays, letters, and transactional writing", "order": 4},
              {"title": "Oral Communication", "description": "Speaking, presentations, and dialogues", "order": 5},
              {"title": "Language Structures", "description": "Sentences, phrases, and punctuation", "order": 6}
            ],
            "Grade 11": [
              {"title": "Language Skills (Advanced)", "description": "Idioms, metaphors, and composition", "order": 1},
              {"title": "Comprehension and Analysis", "description": "In‑depth reading and analysis", "order": 2},
              {"title": "Literature – Drama and Poetry", "description": "Plays and more complex poems", "order": 3},
              {"title": "Writing – Advanced", "description": "Argumentative essays, reviews, and articles", "order": 4},
              {"title": "Oral – Advanced", "description": "Prepared and unprepared speaking", "order": 5},
              {"title": "Language in Context", "description": "Pragmatics and social use of language", "order": 6}
            ],
            "Grade 12": [
              {"title": "Language Control", "description": "Refined language use, register, and style", "order": 1},
              {"title": "Literature – Novels and Drama", "description": "Extended texts, thematic analysis, and critical responses", "order": 2},
              {"title": "Poetry – Advanced", "description": "In‑depth analysis of poems", "order": 3},
              {"title": "Writing – Mastery", "description": "Essays, features, and creative writing", "order": 4},
              {"title": "Oral Examination", "description": "Prepared speech, interview, and debate", "order": 5},
              {"title": "Literary Theory", "description": "Introduction to literary criticism", "order": 6}
            ]
          },
          "isiZulu Home Language": {
            "Grade 10": [
              {"title": "Ulimi – Uhlelo LwesiZulu", "description": "Izakhi, izinkathi, izivumelwano, nezisho", "order": 1},
              {"title": "Ulimi – Isifundo Sokufunda", "description": "Ukuqonda, ukuhlaziya, nokuphendula", "order": 2},
              {"title": "Izinkondlo", "description": "Ukufunda nokuhlaziya izinkondlo", "order": 3},
              {"title": "Inoveli", "description": "Ukufunda nokuhlaziya amanoveli", "order": 4},
              {"title": "Ukubhala", "description": "Indaba, izinkondlo, nezincwadi", "order": 5},
              {"title": "Ukukhuluma", "description": "Ukukhuluma, izinkulumo, nezinkulumo mbango", "order": 6}
            ],
            "Grade 11": [
              {"title": "Ulimi – Oluthuthukisiwe", "description": "Izigaba, izisho, nezakhiwo eziyinkimbinkimbi", "order": 1},
              {"title": "Izinkondlo Eziyinkimbinkimbi", "description": "Ukuhlaziya izinkondlo ngokujulile", "order": 2},
              {"title": "Umculo Wezwi", "description": "Ukufunda nokuhlaziya amanoveli amade", "order": 3},
              {"title": "Idrama", "description": "Ukufunda nokuhlaziya idrama", "order": 4},
              {"title": "Ukubhala – Oluthuthukisiwe", "description": "Indaba, amaphephandaba, nezincwadi", "order": 5},
              {"title": "Ukukhuluma – Oluthuthukisiwe", "description": "Izinkulumo, izingxoxo, nezinkulumo mbango", "order": 6}
            ],
            "Grade 12": [
              {"title": "Ulimi – Oluphelele", "description": "Uhlelo, isitayela, nokusetshenziswa kolimi", "order": 1},
              {"title": "Izinkondlo – Oluphelele", "description": "Ukuhlaziya izinkondlo ngokujulile", "order": 2},
              {"title": "Inoveli – Oluphelele", "description": "Ukuhlaziya amanoveli amade", "order": 3},
              {"title": "Idrama – Oluphelele", "description": "Ukuhlaziya idrama", "order": 4},
              {"title": "Ukubhala – Oluphelele", "description": "Amaphephandaba, izinkondlo, nezincwadi", "order": 5},
              {"title": "Ukukhuluma – Oluphelele", "description": "Izinkulumo, izingxoxo, nezinkulumo mbango", "order": 6}
            ]
          },
          "isiZulu First Additional Language": {
            "Grade 10": [
              {"title": "IsiZulu Esisisekelo", "description": "Uhlelo, izinkathi, namagama", "order": 1},
              {"title": "Ukufunda nokuqonda", "description": "Ukuqonda nokuphendula", "order": 2},
              {"title": "Izinkondlo Ezilula", "description": "Ukufunda nokuhlaziya izinkondlo", "order": 3},
              {"title": "Izindaba Ezimfushane", "description": "Ukufunda nokuhlaziya izindaba", "order": 4},
              {"title": "Ukubhala Okuyisisekelo", "description": "Indaba, izincwadi, nezindatshana", "order": 5},
              {"title": "Ukukhuluma Okuyisisekelo", "description": "Ukukhuluma nokwethula", "order": 6}
            ],
            "Grade 11": [
              {"title": "IsiZulu Esithuthukisiwe", "description": "Uhlelo oluyinkimbinkimbi, izisho", "order": 1},
              {"title": "Ukufunda nokuqonda – Oluthuthukisiwe", "description": "Ukuhlaziya imibhalo", "order": 2},
              {"title": "Izinkondlo – Oluthuthukisiwe", "description": "Ukuhlaziya izinkondlo", "order": 3},
              {"title": "Inoveli neDrama", "description": "Ukufunda nokuhlaziya", "order": 4},
              {"title": "Ukubhala – Oluthuthukisiwe", "description": "Indaba, amaphephandaba, nezincwadi", "order": 5},
              {"title": "Ukukhuluma – Oluthuthukisiwe", "description": "Izinkulumo nokwethula", "order": 6}
            ],
            "Grade 12": [
              {"title": "IsiZulu – Oluphelele", "description": "Uhlelo, isitayela, nokusetshenziswa kolimi", "order": 1},
              {"title": "Izinkondlo neDrama", "description": "Ukuhlaziya okujulile", "order": 2},
              {"title": "Inoveli – Oluphelele", "description": "Ukuhlaziya amanoveli amade", "order": 3},
              {"title": "Ukubhala – Oluphelele", "description": "Izindatshana, amaphephandaba, nezincwadi", "order": 4},
              {"title": "Ukukhuluma – Oluphelele", "description": "Izinkulumo, izingxoxo, nezinkulumo mbango", "order": 5},
              {"title": "Ucwaningo", "description": "Ucwaningo oluncane ngolimi", "order": 6}
            ]
          },
          "isiXhosa Home Language": {
            "Grade 10": [
              {"title": "Ulimi – IsiXhosa", "description": "Uhlelo, izinkathi, izivumelwano, nezisho", "order": 1},
              {"title": "Ukuqonda nokuhlaziya", "description": "Ukufunda nokuphendula imibuzo", "order": 2},
              {"title": "Izinkondlo", "description": "Ukufunda nokuhlaziya izinkondlo", "order": 3},
              {"title": "Iincwadi ezimfutshane", "description": "Ukufunda nokuhlaziya amabali", "order": 4},
              {"title": "Ukubhala", "description": "Amabali, izincwadi, nezibongo", "order": 5},
              {"title": "Ukuthetha", "description": "Ukuthetha, iintetho, neengxoxo", "order": 6}
            ],
            "Grade 11": [
              {"title": "Ulimi – Oluthuthukisiwe", "description": "Izigaba, izisho, nezakhiwo eziyinkimbinkimbi", "order": 1},
              {"title": "Izinkondlo Eziyinkimbinkimbi", "description": "Ukuhlaziya izinkondlo ngokujulile", "order": 2},
              {"title": "Inoveli", "description": "Ukufunda nokuhlaziya inoveli", "order": 3},
              {"title": "Idrama", "description": "Ukufunda nokuhlaziya idrama", "order": 4},
              {"title": "Ukubhala – Oluthuthukisiwe", "description": "Amabali, izincwadi, nezibongo", "order": 5},
              {"title": "Ukuthetha – Oluthuthukisiwe", "description": "Iintetho, iingxoxo, neengxoxo", "order": 6}
            ],
            "Grade 12": [
              {"title": "Ulimi – Oluphelele", "description": "Uhlelo, isitayela, nokusetyenziswa kolimi", "order": 1},
              {"title": "Izinkondlo – Oluphelele", "description": "Ukuhlaziya izinkondlo ngokujulile", "order": 2},
              {"title": "Inoveli – Oluphelele", "description": "Ukuhlaziya inoveli", "order": 3},
              {"title": "Idrama – Oluphelele", "description": "Ukuhlaziya idrama", "order": 4},
              {"title": "Ukubhala – Oluphelele", "description": "Amabali, izincwadi, nezibongo", "order": 5},
              {"title": "Ukuthetha – Oluphelele", "description": "Iintetho, iingxoxo, neengxoxo", "order": 6}
            ]
          },
          "Sepedi Home Language": {
            "Grade 10": [
              {"title": "Sepedi – Pohlo ya Polelo", "description": "Maele, mantšu, le lefoko la Sepedi", "order": 1},
              {"title": "Go bala le go kwešiša", "description": "Go bala le go araba dipotšišo", "order": 2},
              {"title": "Dithothokisi", "description": "Go bala le go hlatholla dithothokisi", "order": 3},
              {"title": "Dikanegelo tse di khutšwane", "description": "Go bala le go hlatholla dikanegelo", "order": 4},
              {"title": "Go ngwala", "description": "Dipale, mangwalo, le dithothokisi", "order": 5},
              {"title": "Go bolela", "description": "Go bolela, dipuo, le dipolelo", "order": 6}
            ],
            "Grade 11": [
              {"title": "Sepedi – Pohlo ya Polelo e Tšwetšego Pele", "description": "Maele a maswa, mehuta ya mantšu, le dipolelo tše di raraganego", "order": 1},
              {"title": "Dithothokisi – Tše di Tšwetšego Pele", "description": "Go hlatholla dithothokisi ka botlalo", "order": 2},
              {"title": "Padi", "description": "Go bala le go hlatholla padi", "order": 3},
              {"title": "Tshekatsheko ya Padi", "description": "Go hlatholla padi ka botlalo", "order": 4},
              {"title": "Go ngwala – Go Tšwetša Pele", "description": "Dipale, mangwalo, le dithothokisi", "order": 5},
              {"title": "Go bolela – Go Tšwetša Pele", "description": "Dipuo, dipolelo, le dipotšišo", "order": 6}
            ],
            "Grade 12": [
              {"title": "Sepedi – Pohlo ya Polelo e Fetlegilego", "description": "Polelo, maele, le mehuta ya mantšu", "order": 1},
              {"title": "Dithothokisi – Tše di Fetlegilego", "description": "Go hlatholla dithothokisi ka botlalo", "order": 2},
              {"title": "Padi – Tše di Fetlegilego", "description": "Go hlatholla padi ka botlalo", "order": 3},
              {"title": "Tshekatsheko ya Padi", "description": "Go hlatholla padi ka botlalo", "order": 4},
              {"title": "Go ngwala – Go Fetlegilego", "description": "Dipale, mangwalo, le dithothokisi", "order": 5},
              {"title": "Go bolela – Go Fetlegilego", "description": "Dipuo, dipolelo, le dipotšišo", "order": 6}
            ]
          },
          "Setswana Home Language": {
            "Grade 10": [
              {"title": "Setswana – Thutapuo", "description": "Maele, mantšu, le polelo ya Setswana", "order": 1},
              {"title": "Go bala le go kwešiša", "description": "Go bala le go araba dipotšišo", "order": 2},
              {"title": "Dithothokisi", "description": "Go bala le go hlatholla dithothokisi", "order": 3},
              {"title": "Dikanegelo tse di khutšwane", "description": "Go bala le go hlatholla dikanegelo", "order": 4},
              {"title": "Go ngwala", "description": "Dipale, mangwalo, le dithothokisi", "order": 5},
              {"title": "Go bolela", "description": "Go bolela, dipuo, le dipolelo", "order": 6}
            ],
            "Grade 11": [
              {"title": "Setswana – Thutapuo e Tšwetšego Pele", "description": "Maele a maswa, mehuta ya mantšu, le dipolelo tše di raraganego", "order": 1},
              {"title": "Dithothokisi – Tše di Tšwetšego Pele", "description": "Go hlatholla dithothokisi ka botlalo", "order": 2},
              {"title": "Padi", "description": "Go bala le go hlatholla padi", "order": 3},
              {"title": "Tshekatsheko ya Padi", "description": "Go hlatholla padi ka botlalo", "order": 4},
              {"title": "Go ngwala – Go Tšwetša Pele", "description": "Dipale, mangwalo, le dithothokisi", "order": 5},
              {"title": "Go bolela – Go Tšwetša Pele", "description": "Dipuo, dipolelo, le dipotšišo", "order": 6}
            ],
            "Grade 12": [
              {"title": "Setswana – Thutapuo e Fetlegilego", "description": "Polelo, maele, le mehuta ya mantšu", "order": 1},
              {"title": "Dithothokisi – Tše di Fetlegilego", "description": "Go hlatholla dithothokisi ka botlalo", "order": 2},
              {"title": "Padi – Tše di Fetlegilego", "description": "Go hlatholla padi ka botlalo", "order": 3},
              {"title": "Tshekatsheko ya Padi", "description": "Go hlatholla padi ka botlalo", "order": 4},
              {"title": "Go ngwala – Go Fetlegilego", "description": "Dipale, mangwalo, le dithothokisi", "order": 5},
              {"title": "Go bolela – Go Fetlegilego", "description": "Dipuo, dipolelo, le dipotšišo", "order": 6}
            ]
          },
          "Siswati Home Language": {
            "Grade 10": [
              {"title": "Siswati – Kuhlakanipha Lulwimi", "description": "Tincwadi, tichaza, nemisho", "order": 1},
              {"title": "Kufundza nekucondza", "description": "Kufundza nekuphendvula imibuzo", "order": 2},
              {"title": "Tinkondlo", "description": "Kufundza nekuhlaziya tinkondlo", "order": 3},
              {"title": "Tindzaba letimfishane", "description": "Kufundza nekuhlaziya tindzaba", "order": 4},
              {"title": "Kubhala", "description": "Tindzaba, tincwadi, netinkondlo", "order": 5},
              {"title": "Kukhuluma", "description": "Kukhuluma, tikhulumo, nekuphikisana", "order": 6}
            ],
            "Grade 11": [
              {"title": "Siswati – Lulwimi Loluthuthukile", "description": "Tincwadi, tichaza, nemisho leyinkimbinkimbi", "order": 1},
              {"title": "Tinkondlo Letithuthukile", "description": "Kuhlaziya tinkondlo", "order": 2},
              {"title": "Inoveli", "description": "Kufundza nekuhlaziya inoveli", "order": 3},
              {"title": "Idrama", "description": "Kufundza nekuhlaziya idrama", "order": 4},
              {"title": "Kubhala – Loluthuthukile", "description": "Tindzaba, tincwadi, netinkondlo", "order": 5},
              {"title": "Kukhuluma – Loluthuthukile", "description": "Tikhulumo, izingxoxo, nekuphikisana", "order": 6}
            ],
            "Grade 12": [
              {"title": "Siswati – Lulwimi Loluphelele", "description": "Tincwadi, tichaza, nemisho", "order": 1},
              {"title": "Tinkondlo – Letiphelele", "description": "Kuhlaziya tinkondlo", "order": 2},
              {"title": "Inoveli – Letiphelele", "description": "Kuhlaziya inoveli", "order": 3},
              {"title": "Idrama – Letiphelele", "description": "Kuhlaziya idrama", "order": 4},
              {"title": "Kubhala – Lokuphelele", "description": "Tindzaba, tincwadi, netinkondlo", "order": 5},
              {"title": "Kukhuluma – Lokuphelele", "description": "Tikhulumo, izingxoxo, nekuphikisana", "order": 6}
            ]
          },
          "Tshivenda Home Language": {
            "Grade 10": [
              {"title": "Tshivenda – Luambo", "description": "Mahayani, maipfi, na mipfumo", "order": 1},
              {"title": "U farisa na u pfesesa", "description": "U farisa na u fhindula mbudziso", "order": 2},
              {"title": "Mbilu na Mutsindo", "description": "U farisa na u saukanya mbilu", "order": 3},
              {"title": "Mafhungo a fupfuthu", "description": "U farisa na u saukanya mafhungo", "order": 4},
              {"title": "U ngwala", "description": "Mafhungo, mangwalo, na mbilu", "order": 5},
              {"title": "U amba", "description": "U amba, maano, na u phikisana", "order": 6}
            ],
            "Grade 11": [
              {"title": "Tshivenda – Luambo lwa Ntha", "description": "Mahayani, maipfi, na mipfumo ya khaḓa", "order": 1},
              {"title": "Mbilu na Mutsindo wa Ntha", "description": "U saukanya mbilu", "order": 2},
              {"title": "Bugu ya Ntha", "description": "U farisa na u saukanya bugu", "order": 3},
              {"title": "Drama ya Ntha", "description": "U farisa na u saukanya drama", "order": 4},
              {"title": "U ngwala ha Ntha", "description": "Mafhungo, mangwalo, na mbilu", "order": 5},
              {"title": "U amba ha Ntha", "description": "Maano, na u phikisana", "order": 6}
            ],
            "Grade 12": [
              {"title": "Tshivenda – Luambo lwa Muvhuso", "description": "Mahayani, maipfi, na mipfumo ya khaḓa", "order": 1},
              {"title": "Mbilu na Mutsindo wa Muvhuso", "description": "U saukanya mbilu", "order": 2},
              {"title": "Bugu ya Muvhuso", "description": "U saukanya bugu", "order": 3},
              {"title": "Drama ya Muvhuso", "description": "U saukanya drama", "order": 4},
              {"title": "U ngwala ha Muvhuso", "description": "Mafhungo, mangwalo, na mbilu", "order": 5},
              {"title": "U amba ha Muvhuso", "description": "Maano, na u phikisana", "order": 6}
            ]
          },
          "Xitsonga Home Language": {
            "Grade 10": [
              {"title": "Xitsonga – Ririmi", "description": "Mavito, marito, na mipfumo", "order": 1},
              {"title": "Ku hlaya na ku twisisa", "description": "Ku hlaya na ku hlamula swivutiso", "order": 2},
              {"title": "Tinsimu", "description": "Ku hlaya na ku hlaya tinsimu", "order": 3},
              {"title": "Tindzimi leti kulu", "description": "Ku hlaya na ku hlaya tindzimi", "order": 4},
              {"title": "Ku tsala", "description": "Tindzimi, tinsimu, na tikhundla", "order": 5},
              {"title": "Ku vulavula", "description": "Ku vulavula, ku vulavula, na ku phikisana", "order": 6}
            ],
            "Grade 11": [
              {"title": "Xitsonga – Ririmi ra Ntlawa", "description": "Mavito, marito, na mipfumo ya khaḓa", "order": 1},
              {"title": "Tinsimu ta Ntlawa", "description": "Ku hlaya na ku hlaya tinsimu", "order": 2},
              {"title": "Xikwembu xa Ntlawa", "description": "Ku hlaya na ku hlaya xikwembu", "order": 3},
              {"title": "Drama ya Ntlawa", "description": "Ku hlaya na ku hlaya drama", "order": 4},
              {"title": "Ku tsala ka Ntlawa", "description": "Tindzimi, tinsimu, na tikhundla", "order": 5},
              {"title": "Ku vulavula ka Ntlawa", "description": "Ku vulavula, ku vulavula, na ku phikisana", "order": 6}
            ],
            "Grade 12": [
              {"title": "Xitsonga – Ririmi ra Mfumo", "description": "Mavito, marito, na mipfumo ya khaḓa", "order": 1},
              {"title": "Tinsimu ta Mfumo", "description": "Ku hlaya na ku hlaya tinsimu", "order": 2},
              {"title": "Xikwembu xa Mfumo", "description": "Ku hlaya na ku hlaya xikwembu", "order": 3},
              {"title": "Drama ya Mfumo", "description": "Ku hlaya na ku hlaya drama", "order": 4},
              {"title": "Ku tsala ka Mfumo", "description": "Tindzimi, tinsimu, na tikhundla", "order": 5},
              {"title": "Ku vulavula ka Mfumo", "description": "Ku vulavula, ku vulavula, na ku phikisana", "order": 6}
            ]
          }
        }'::JSONB;

        -- Iterate over all subjects linked to CAPS
        FOR subject_record IN
          SELECT s.id, s.name
          FROM subjects s
          JOIN curriculum_subjects cs ON cs.subject_id = s.id
          WHERE cs.curriculum_id = caps_id
        LOOP
          subject_name := subject_record.name;

          -- Get the topics for this subject from the lookup
          topics_for_subject := topic_data->subject_name;

          IF topics_for_subject IS NULL THEN
            RAISE NOTICE 'No topic data found for subject: %', subject_name;
            CONTINUE;
          END IF;

          -- For each grade
          FOREACH grade_text IN ARRAY grade_array LOOP
            -- Get topics for this grade
            IF topics_for_subject ? grade_text THEN
              -- Insert each topic into temp_topics
              FOR topic_record IN
                SELECT
                  (topic->>'title') AS title,
                  (topic->>'description') AS description,
                  (topic->>'order')::INTEGER AS order_number
                FROM jsonb_array_elements(topics_for_subject->grade_text) AS topic
              LOOP
                INSERT INTO temp_topics (subject_id, grade, title, description, order_number)
                VALUES (subject_record.id, grade_text, topic_record.title, topic_record.description, topic_record.order_number);
              END LOOP;
            END IF;
          END LOOP;
        END LOOP;

        -- Insert all collected topics into the topics table
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
        RAISE NOTICE '✅ CAPS topics seeded for all subjects (Grades 10, 11, 12).';
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
    console.log('✅ Stage 2: Subject catalogue expanded and linked to CAPS/IEB');
    console.log('✅ Stage 3: Topics unique constraint migrated and CAPS topics seeded for all subjects.');
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