router.post('/signup', async (req, res) => {
  const { 
    firstName, lastName, email, password, countryId, 
    provinceId, schoolId, curriculumId, educationLevelId, 
    gradeId, subjectIds, role 
  } = req.body;

  // Basic validation
  if (!firstName || !lastName || !email || !password || !countryId || !curriculumId || !educationLevelId || !gradeId) {
    return res.status(400).json({ error: 'Missing required registration fields' });
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN'); // Start Transaction

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Insert into users table
    const userResult = await client.query(
      `INSERT INTO users (
        first_name, last_name, email, password_hash, country_id, province_id, 
        school_id, curriculum_id, education_level_id, grade_id, role
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, first_name, last_name, email, role`,
      [
        firstName, lastName, email, password, countryId, provinceId || null, 
        schoolId || null, curriculumId, educationLevelId, gradeId, role || 'learner'
      ]
    );

    const newUser = userResult.rows[0];

    // Insert selected subjects into junction table
    if (Array.isArray(subjectIds) && subjectIds.length > 0) {
      const subjectValues = subjectIds.map((id, index) => `($1, $${index + 2})`).join(', ');
      const subjectParams = [newUser.id, ...subjectIds];
      
      await client.query(
        `INSERT INTO user_subjects (user_id, subject_id) VALUES ${subjectValues}`,
        subjectParams
      );
    }

    await client.query('COMMIT'); // Commit Transaction
    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    await client.query('ROLLBACK'); // Rollback on error
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  } finally {
    client.release();
  }
});