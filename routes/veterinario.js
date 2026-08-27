const express = require('express');

const db = require('../database');
const { ensureVet } = require('../middleware/auth');
const { uploadPhoto, uploadDocument } = require('../middleware/uploads');
const { verifyCsrf } = require('../middleware/csrf');

const router = express.Router();

router.use(ensureVet);

// Gestão de acesso da equipe (promover veterinários, root, etc.)
router.use('/equipe', require('./equipe'));

// ── Utilidades ───────────────────────────────────────────────────────────────
const STATUSES = ['abrigo', 'hospital', 'clinica', 'adotado', 'falecido'];
const SEXES = ['macho', 'fêmea', 'indeterminado'];
const SIZES = ['pequeno', 'medio', 'grande'];
const RETRO = ['nao_testado', 'negativo', 'positivo', 'indeterminado'];
const KINDS = ['gatil', 'canil', 'baia', 'quarentena', 'outro'];
const DEWORM_KINDS = ['vermifugo', 'antipulgas', 'carrapaticida', 'outro'];

const pick = (value, allowed, fallback = null) => (allowed.includes(value) ? value : fallback);
const text = (value, max = 500) => {
  const str = String(value ?? '').trim();
  return str ? str.slice(0, max) : null;
};
const num = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
// <input type="date"> vazio chega como "" e viraria a string vazia no banco,
// que quebra as comparações date(...) do SQLite. Melhor gravar NULL.
const dateOrNull = (value) => (String(value || '').trim() ? String(value).trim() : null);

function notFound(res, backUrl = '/vet/dashboard') {
  return res.status(404).render('error', {
    title: 'Não encontrado',
    code: 404,
    message: 'O registro solicitado não existe.',
    backUrl
  });
}

async function animalExists(id) {
  return db.get('SELECT id FROM animals WHERE id = ?', [id]);
}

// Marca a ficha como mexida — alimenta o contador "atualizadas hoje".
async function touchAnimal(id) {
  await db.run("UPDATE animals SET updated_at = datetime('now') WHERE id = ?", [id]);
}

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  try {
    const [counts, animals, environments, alerts] = await Promise.all([
      db.get(`
        SELECT
          (SELECT COUNT(*) FROM animals)                                              AS total_animais,
          (SELECT COUNT(*) FROM animals WHERE status IN ('hospital','clinica'))        AS em_tratamento,
          (SELECT COUNT(*) FROM animals WHERE status = 'adotado')                      AS adotados,
          (SELECT COUNT(*) FROM animals WHERE status = 'abrigo')                       AS no_abrigo,
          (SELECT COUNT(*) FROM animals WHERE LOWER(species) = 'gato')                 AS total_gatos,
          (SELECT COUNT(*) FROM animals WHERE LOWER(species) = 'cachorro')             AS total_cachorros,
          (SELECT COUNT(*) FROM animals WHERE neutered = 1)                            AS castrados,
          (SELECT COUNT(*) FROM environments WHERE active = 1)                         AS total_ambientes,
          (SELECT COUNT(*) FROM hospitalizations WHERE exit_date IS NULL)              AS internados,
          (SELECT COUNT(*) FROM vaccines
             WHERE next_dose IS NOT NULL AND date(next_dose) <= date('now'))           AS vacinas_vencidas,
          (SELECT COUNT(*) FROM dewormings
             WHERE next_application IS NOT NULL
               AND date(next_application) <= date('now'))                              AS vermifugos_vencidos,
          (SELECT COUNT(*) FROM medications
             WHERE stock_quantity <= min_stock_level)                                  AS estoque_baixo
      `),
      db.all(`
        SELECT a.id, a.name, a.species, a.sex, a.age, a.birth_date, a.status,
               a.photo IS NOT NULL AS has_photo, e.name AS environment_name
        FROM animals a
        LEFT JOIN environments e ON a.environment_id = e.id
        ORDER BY a.entry_date DESC LIMIT 8
      `),
      db.all(`
        SELECT e.id, e.name, e.kind, e.capacity, e.color,
               (SELECT COUNT(*) FROM animals a WHERE a.environment_id = e.id) AS ocupacao
        FROM environments e
        WHERE e.active = 1
        ORDER BY e.kind, e.name LIMIT 8
      `),
      db.all(`
        SELECT v.next_dose AS due, a.id AS animal_id, a.name AS animal_name,
               v.name AS item, 'vacina' AS tipo
        FROM vaccines v JOIN animals a ON a.id = v.animal_id
        WHERE v.next_dose IS NOT NULL AND date(v.next_dose) <= date('now','+30 day')
          AND a.status != 'falecido'
        ORDER BY v.next_dose LIMIT 6
      `)
    ]);

    res.render('vet/dashboard', {
      title: 'Dashboard',
      ...counts,
      animals,
      environments,
      alerts
    });
  } catch (err) {
    next(err);
  }
});

// ── Ambientes (gatis / canis / baias) ────────────────────────────────────────
router.get('/ambientes', async (req, res, next) => {
  try {
    const environments = await db.all(`
      SELECT e.*,
             (SELECT COUNT(*) FROM animals a WHERE a.environment_id = e.id) AS ocupacao
      FROM environments e
      WHERE e.active = 1
      ORDER BY e.kind, e.name
    `);

    const semAmbiente = await db.get(`
      SELECT COUNT(*) AS total FROM animals
      WHERE environment_id IS NULL AND status NOT IN ('adotado','falecido')
    `);

    res.render('vet/ambientes', {
      title: 'Ambientes',
      environments,
      semAmbiente: semAmbiente.total,
      kinds: KINDS
    });
  } catch (err) {
    next(err);
  }
});

router.post('/ambientes', async (req, res, next) => {
  try {
    const name = text(req.body.name, 80);
    if (!name) return res.redirect('/vet/ambientes?erro=nome');

    await db.run(
      'INSERT INTO environments (name, kind, capacity, notes, color, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [
        name,
        pick(req.body.kind, KINDS, 'gatil'),
        num(req.body.capacity),
        text(req.body.notes, 300),
        text(req.body.color, 20),
        req.session.user.id
      ]
    );
    res.redirect('/vet/ambientes');
  } catch (err) {
    next(err);
  }
});

router.post('/ambientes/:id', async (req, res, next) => {
  try {
    const name = text(req.body.name, 80);
    if (!name) return res.redirect('/vet/ambientes?erro=nome');

    await db.run(
      'UPDATE environments SET name = ?, kind = ?, capacity = ?, notes = ?, color = ? WHERE id = ?',
      [
        name,
        pick(req.body.kind, KINDS, 'gatil'),
        num(req.body.capacity),
        text(req.body.notes, 300),
        text(req.body.color, 20),
        req.params.id
      ]
    );
    res.redirect('/vet/ambientes');
  } catch (err) {
    next(err);
  }
});

router.post('/ambientes/:id/excluir', async (req, res, next) => {
  try {
    // Os animais não são apagados junto: só ficam sem ambiente, para não
    // sumir com bicho por causa de uma faxina de cadastro.
    await db.run('UPDATE animals SET environment_id = NULL WHERE environment_id = ?', [req.params.id]);
    await db.run('UPDATE environments SET active = 0 WHERE id = ?', [req.params.id]);
    res.redirect('/vet/ambientes');
  } catch (err) {
    next(err);
  }
});

// Animais de um ambiente
router.get('/ambientes/:id', async (req, res, next) => {
  try {
    const environment = await db.get('SELECT * FROM environments WHERE id = ? AND active = 1', [req.params.id]);
    if (!environment) return notFound(res, '/vet/ambientes');

    const animals = await db.all(
      `SELECT id, name, species, sex, age, birth_date, status, neutered, fiv_status, felv_status,
              photo IS NOT NULL AS has_photo
       FROM animals WHERE environment_id = ? ORDER BY name`,
      [req.params.id]
    );

    // Para o seletor "mover animal para cá"
    const disponiveis = await db.all(
      `SELECT id, name, species FROM animals
       WHERE (environment_id IS NULL OR environment_id != ?)
         AND status NOT IN ('adotado','falecido')
       ORDER BY name`,
      [req.params.id]
    );

    res.render('vet/ambiente', { title: environment.name, environment, animals, disponiveis });
  } catch (err) {
    next(err);
  }
});

// Mover animal entre ambientes
router.post('/ambientes/:id/animais', async (req, res, next) => {
  try {
    const animalId = num(req.body.animal_id);
    if (!animalId) return res.redirect(`/vet/ambientes/${req.params.id}`);
    await db.run('UPDATE animals SET environment_id = ? WHERE id = ?', [req.params.id, animalId]);
    res.redirect(`/vet/ambientes/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/ambientes/:id/animais/:animalId/remover', async (req, res, next) => {
  try {
    await db.run('UPDATE animals SET environment_id = NULL WHERE id = ? AND environment_id = ?', [
      req.params.animalId,
      req.params.id
    ]);
    res.redirect(`/vet/ambientes/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// ── Listagem de animais ──────────────────────────────────────────────────────
router.get('/animais', async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim();
    const status = pick(String(req.query.status || ''), STATUSES);
    const species = String(req.query.especie || '').trim();
    const envId = num(req.query.ambiente);

    const where = [];
    const params = [];

    if (search) {
      where.push('(a.name LIKE ? OR a.breed LIKE ? OR a.chip_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      where.push('a.status = ?');
      params.push(status);
    }
    if (species) {
      where.push('LOWER(a.species) = LOWER(?)');
      params.push(species);
    }
    if (envId) {
      where.push('a.environment_id = ?');
      params.push(envId);
    }

    const animals = await db.all(
      `SELECT a.id, a.name, a.species, a.breed, a.sex, a.age, a.birth_date, a.status,
              a.neutered, a.fiv_status, a.felv_status, a.chip_number,
              a.photo IS NOT NULL AS has_photo,
              e.name AS environment_name, e.kind AS environment_kind
       FROM animals a
       LEFT JOIN environments e ON a.environment_id = e.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.entry_date DESC`,
      params
    );

    const [especies, environments] = await Promise.all([
      db.all('SELECT DISTINCT species FROM animals ORDER BY species'),
      db.all('SELECT id, name, kind FROM environments WHERE active = 1 ORDER BY name')
    ]);

    res.render('vet/animais', {
      title: 'Animais',
      animals,
      especies,
      environments,
      filtros: { search, status, species, ambiente: envId },
      statuses: STATUSES
    });
  } catch (err) {
    next(err);
  }
});

// Compatibilidade com os links antigos
router.get('/biblioteca', (req, res) => res.redirect('/vet/animais'));
router.get('/search', (req, res) => res.redirect(`/vet/animais?q=${encodeURIComponent(req.query.name || '')}`));
router.get('/animais/tratamento', (req, res) => res.redirect('/vet/animais?status=hospital'));
router.get('/animais/adotados', (req, res) => res.redirect('/vet/animais?status=adotado'));
router.get('/animais/especie/:species', (req, res) =>
  res.redirect(`/vet/animais?especie=${encodeURIComponent(req.params.species)}`)
);

// ── Cadastro de animal ───────────────────────────────────────────────────────
router.get('/cadastrar-animal', async (req, res, next) => {
  try {
    const environments = await db.all('SELECT id, name, kind FROM environments WHERE active = 1 ORDER BY name');
    res.render('vet/cadastra_animal', { title: 'Cadastrar animal', environments, sizes: SIZES, retro: RETRO });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/cadastrar-animal',
  uploadPhoto.single('photo'),
  verifyCsrf,
  async (req, res, next) => {
    const rerender = async (error) => {
      const environments = await db.all('SELECT id, name, kind FROM environments WHERE active = 1 ORDER BY name');
      return res.status(400).render('vet/cadastra_animal', {
        title: 'Cadastrar animal',
        environments,
        sizes: SIZES,
        retro: RETRO,
        error,
        form: req.body
      });
    };

    try {
      const name = text(req.body.name, 80);
      const species = text(req.body.species, 40);
      if (!name || !species) return rerender('Nome e espécie são obrigatórios.');

      // Chip vazio precisa virar NULL: string vazia colide na constraint UNIQUE
      // e o segundo animal sem chip falharia no cadastro.
      const chip = text(req.body.chip_number, 60);

      const { lastID } = await db.run(
        `INSERT INTO animals
          (name, species, breed, age, birth_date, sex, size, photo, photo_mimetype, chip_number,
           status, characteristics, description, environment_id, neutered, neutered_date,
           fiv_status, felv_status, retro_test_date, created_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        [
          name,
          species,
          text(req.body.breed, 60),
          num(req.body.age),
          dateOrNull(req.body.birth_date),
          pick(req.body.sex, SEXES),
          pick(req.body.size, SIZES),
          req.file ? req.file.buffer : null,
          req.file ? req.file.mimetype : null,
          chip,
          pick(req.body.status, STATUSES, 'abrigo'),
          text(req.body.characteristics, 1000),
          text(req.body.description, 2000),
          num(req.body.environment_id),
          req.body.neutered ? 1 : 0,
          dateOrNull(req.body.neutered_date),
          pick(req.body.fiv_status, RETRO, 'nao_testado'),
          pick(req.body.felv_status, RETRO, 'nao_testado'),
          dateOrNull(req.body.retro_test_date),
          req.session.user.id
        ]
      );

      return res.redirect(`/vet/animal/${lastID}`);
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        return rerender('Já existe um animal com este número de chip.');
      }
      next(err);
    }
  }
);

// ── Ficha completa ───────────────────────────────────────────────────────────
router.get('/animal/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const animal = await db.get(
      `SELECT a.*, a.photo IS NOT NULL AS has_photo, e.name AS environment_name, e.kind AS environment_kind
       FROM animals a LEFT JOIN environments e ON a.environment_id = e.id
       WHERE a.id = ?`,
      [id]
    );
    if (!animal) return notFound(res);

    /*
     * As oito consultas abaixo eram callbacks aninhados oito níveis: cada `err`
     * interno sombreava o anterior e nenhum era tratado, então uma falha no meio
     * renderizava a ficha silenciosamente incompleta. Em paralelo e com await,
     * qualquer erro sobe para o handler.
     */
    const [
      healthRecords,
      vaccines,
      dewormings,
      hospitalizations,
      procedures,
      documents,
      photos,
      medications,
      environments
    ] = await Promise.all([
      db.all('SELECT * FROM health_records WHERE animal_id = ? ORDER BY updated_at DESC', [id]),
      db.all('SELECT * FROM vaccines WHERE animal_id = ? ORDER BY application_date DESC', [id]),
      db.all('SELECT * FROM dewormings WHERE animal_id = ? ORDER BY application_date DESC', [id]),
      db.all('SELECT * FROM hospitalizations WHERE animal_id = ? ORDER BY entry_date DESC', [id]),
      db.all('SELECT * FROM procedures WHERE animal_id = ? ORDER BY procedure_date DESC', [id]),
      db.all(
        'SELECT id, filename, description, upload_date FROM animal_documents WHERE animal_id = ? ORDER BY upload_date DESC',
        [id]
      ),
      db.all('SELECT id, description, upload_date FROM animal_photos WHERE animal_id = ? ORDER BY upload_date DESC', [id]),
      db.all(
        `SELECT am.*, m.name AS medication_name, m.unit
         FROM animal_medications am JOIN medications m ON am.medication_id = m.id
         WHERE am.animal_id = ? ORDER BY am.start_date DESC`,
        [id]
      ),
      db.all('SELECT id, name, kind FROM environments WHERE active = 1 ORDER BY name')
    ]);

    res.render('vet/ficha', {
      title: animal.name,
      animal,
      healthRecords,
      healthRecord: healthRecords[0] || null,
      vaccines,
      dewormings,
      hospitalizations,
      internacaoAberta: hospitalizations.find((h) => !h.exit_date) || null,
      procedures,
      documents,
      photos,
      medications,
      environments,
      // Usado na confirmação de exclusão, para a pessoa ver o que vai junto.
      totalRegistros:
        healthRecords.length +
        vaccines.length +
        dewormings.length +
        procedures.length +
        hospitalizations.length +
        medications.length +
        documents.length +
        photos.length,
      statuses: STATUSES,
      sexes: SEXES,
      sizes: SIZES,
      retro: RETRO,
      dewormKinds: DEWORM_KINDS
    });
  } catch (err) {
    next(err);
  }
});

// ── Edição do animal ─────────────────────────────────────────────────────────
router.post('/animal/:id/info', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!(await animalExists(id))) return notFound(res);

    const name = text(req.body.name, 80);
    const species = text(req.body.species, 40);
    if (!name || !species) return res.redirect(`/vet/animal/${id}?erro=obrigatorios`);

    await db.run(
      `UPDATE animals SET
         name = ?, species = ?, breed = ?, age = ?, birth_date = ?, sex = ?, size = ?,
         chip_number = ?, description = ?, characteristics = ?, environment_id = ?,
         neutered = ?, neutered_date = ?, fiv_status = ?, felv_status = ?, retro_test_date = ?,
         tutor_name = ?, tutor_contact = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        name,
        species,
        text(req.body.breed, 60),
        num(req.body.age),
        dateOrNull(req.body.birth_date),
        pick(req.body.sex, SEXES),
        pick(req.body.size, SIZES),
        text(req.body.chip_number, 60),
        text(req.body.description, 2000),
        text(req.body.characteristics, 1000),
        num(req.body.environment_id),
        req.body.neutered ? 1 : 0,
        dateOrNull(req.body.neutered_date),
        pick(req.body.fiv_status, RETRO, 'nao_testado'),
        pick(req.body.felv_status, RETRO, 'nao_testado'),
        dateOrNull(req.body.retro_test_date),
        text(req.body.tutor_name, 120),
        text(req.body.tutor_contact, 120),
        id
      ]
    );
    res.redirect(`/vet/animal/${id}`);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.redirect(`/vet/animal/${req.params.id}?erro=chip`);
    }
    next(err);
  }
});

router.post('/animal/:id/status', async (req, res, next) => {
  try {
    const id = req.params.id;
    const status = pick(req.body.status, STATUSES);
    if (!status) return res.redirect(`/vet/animal/${id}?erro=status`);

    // Adoção e óbito arrastam informação junto; guardar isso evita ter que
    // reconstruir a história do animal depois olhando só a data de alteração.
    if (status === 'adotado') {
      await db.run(
        `UPDATE animals SET status = ?, adoption_date = COALESCE(?, date('now')),
                            tutor_name = COALESCE(?, tutor_name), tutor_contact = COALESCE(?, tutor_contact),
                            environment_id = NULL, updated_at = datetime('now')
         WHERE id = ?`,
        [status, dateOrNull(req.body.adoption_date), text(req.body.tutor_name, 120), text(req.body.tutor_contact, 120), id]
      );
    } else if (status === 'falecido') {
      await db.run(
        `UPDATE animals SET status = ?, deceased_date = COALESCE(?, date('now')),
                            deceased_cause = ?, environment_id = NULL, updated_at = datetime('now')
         WHERE id = ?`,
        [status, dateOrNull(req.body.deceased_date), text(req.body.deceased_cause, 300), id]
      );
    } else {
      await db.run("UPDATE animals SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);
    }

    res.redirect(`/vet/animal/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/animal/:id/photo', uploadPhoto.single('photo'), verifyCsrf, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!req.file) return res.redirect(`/vet/animal/${id}?erro=foto`);
    await db.run('UPDATE animals SET photo = ?, photo_mimetype = ? WHERE id = ?', [
      req.file.buffer,
      req.file.mimetype,
      id
    ]);
    res.redirect(`/vet/animal/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/animal/:id/galeria', uploadPhoto.single('photo'), verifyCsrf, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!req.file) return res.redirect(`/vet/animal/${id}?erro=foto`);
    await db.run(
      'INSERT INTO animal_photos (animal_id, photo, mimetype, description, uploaded_by) VALUES (?,?,?,?,?)',
      [id, req.file.buffer, req.file.mimetype, text(req.body.description, 200), req.session.user.id]
    );
    res.redirect(`/vet/animal/${id}`);
  } catch (err) {
    next(err);
  }
});

// ── Registros clínicos ───────────────────────────────────────────────────────
router.post('/animal/:id/health-record', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!(await animalExists(id))) return notFound(res);

    await db.run(
      `INSERT INTO health_records (animal_id, weight, body_condition, observations, allergies, created_by)
       VALUES (?,?,?,?,?,?)`,
      [
        id,
        num(req.body.weight),
        text(req.body.body_condition, 40),
        text(req.body.observations, 2000),
        text(req.body.allergies, 500),
        req.session.user.id
      ]
    );
    await touchAnimal(id);
    res.redirect(`/vet/animal/${id}#saude`);
  } catch (err) {
    next(err);
  }
});

router.post('/animal/:id/vaccine', async (req, res, next) => {
  try {
    const id = req.params.id;
    const name = text(req.body.name, 80);
    const applicationDate = dateOrNull(req.body.application_date);
    if (!name || !applicationDate) return res.redirect(`/vet/animal/${id}?erro=vacina`);

    await db.run(
      `INSERT INTO vaccines (animal_id, name, application_date, next_dose, batch, veterinarian_id, observations)
       VALUES (?,?,?,?,?,?,?)`,
      [
        id,
        name,
        applicationDate,
        dateOrNull(req.body.next_dose),
        text(req.body.batch, 60),
        req.session.user.id,
        text(req.body.observations, 500)
      ]
    );
    await touchAnimal(id);
    res.redirect(`/vet/animal/${id}#vacinas`);
  } catch (err) {
    next(err);
  }
});

// Vermifugação / antipulgas — não existia e é controle obrigatório em coletivo
router.post('/animal/:id/vermifugacao', async (req, res, next) => {
  try {
    const id = req.params.id;
    const product = text(req.body.product, 80);
    const applicationDate = dateOrNull(req.body.application_date);
    if (!product || !applicationDate) return res.redirect(`/vet/animal/${id}?erro=vermifugo`);

    await db.run(
      `INSERT INTO dewormings (animal_id, product, kind, application_date, next_application, dosage, veterinarian_id, observations)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        id,
        product,
        pick(req.body.kind, DEWORM_KINDS, 'vermifugo'),
        applicationDate,
        dateOrNull(req.body.next_application),
        text(req.body.dosage, 60),
        req.session.user.id,
        text(req.body.observations, 500)
      ]
    );
    await touchAnimal(id);
    res.redirect(`/vet/animal/${id}#vermifugacao`);
  } catch (err) {
    next(err);
  }
});

router.post('/animal/:id/procedure', async (req, res, next) => {
  try {
    const id = req.params.id;
    const name = text(req.body.name, 120);
    const procedureDate = dateOrNull(req.body.procedure_date);
    if (!name || !procedureDate) return res.redirect(`/vet/animal/${id}?erro=procedimento`);

    await db.run(
      `INSERT INTO procedures (animal_id, name, procedure_date, description, veterinarian_id, observations)
       VALUES (?,?,?,?,?,?)`,
      [id, name, procedureDate, text(req.body.description, 2000), req.session.user.id, text(req.body.observations, 500)]
    );
    await touchAnimal(id);
    res.redirect(`/vet/animal/${id}#procedimentos`);
  } catch (err) {
    next(err);
  }
});

router.post('/animal/:id/hospitalization', async (req, res, next) => {
  try {
    const id = req.params.id;
    const entryDate = dateOrNull(req.body.entry_date);
    const reason = text(req.body.reason, 300);
    if (!entryDate || !reason) return res.redirect(`/vet/animal/${id}?erro=internacao`);

    await db.run(
      `INSERT INTO hospitalizations
        (animal_id, entry_date, reason, diagnosis, treatment, procedures, observations, responsible_vet)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        id,
        entryDate,
        reason,
        text(req.body.diagnosis, 2000),
        text(req.body.treatment, 2000),
        text(req.body.procedures, 2000),
        text(req.body.observations, 1000),
        req.session.user.id
      ]
    );
    await db.run("UPDATE animals SET status = 'hospital', updated_at = datetime('now') WHERE id = ?", [id]);
    res.redirect(`/vet/animal/${id}#internacoes`);
  } catch (err) {
    next(err);
  }
});

/*
 * Alta da internação.
 *
 * As colunas exit_date/exit_status existiam no schema desde a v1, mas nenhuma
 * rota ou tela as preenchia: o animal entrava com status "hospital" e ficava
 * internado para sempre, e "Em tratamento" no dashboard só crescia.
 */
router.post('/internacao/:hospId/alta', async (req, res, next) => {
  try {
    const hosp = await db.get('SELECT id, animal_id FROM hospitalizations WHERE id = ?', [req.params.hospId]);
    if (!hosp) return notFound(res);

    await db.run(
      `UPDATE hospitalizations
         SET exit_date = COALESCE(?, date('now')), exit_status = ?,
             observations = COALESCE(?, observations)
       WHERE id = ?`,
      [dateOrNull(req.body.exit_date), text(req.body.exit_status, 200), text(req.body.observations, 1000), hosp.id]
    );

    const novoStatus = pick(req.body.animal_status, STATUSES, 'abrigo');
    await db.run("UPDATE animals SET status = ?, updated_at = datetime('now') WHERE id = ?", [
      novoStatus,
      hosp.animal_id
    ]);

    res.redirect(`/vet/animal/${hosp.animal_id}#internacoes`);
  } catch (err) {
    next(err);
  }
});

router.post('/animal/:id/receita', async (req, res, next) => {
  try {
    const id = req.params.id;
    const medicationName = text(req.body.medication_name, 100);
    const dosage = text(req.body.dosage, 100);
    const frequency = text(req.body.frequency, 100);
    const startDate = dateOrNull(req.body.start_date);

    if (!medicationName || !dosage || !frequency || !startDate) {
      return res.redirect(`/vet/animal/${id}?erro=receita`);
    }

    let med = await db.get('SELECT id FROM medications WHERE LOWER(name) = LOWER(?)', [medicationName]);
    if (!med) {
      const created = await db.run('INSERT INTO medications (name) VALUES (?)', [medicationName]);
      med = { id: created.lastID };
    }

    await db.run(
      `INSERT INTO animal_medications
        (animal_id, medication_id, dosage, frequency, start_date, end_date, prescribed_by, observations, status)
       VALUES (?,?,?,?,?,?,?,?,'ativo')`,
      [
        id,
        med.id,
        dosage,
        frequency,
        startDate,
        dateOrNull(req.body.end_date),
        req.session.user.id,
        text(req.body.notes, 500)
      ]
    );
    await touchAnimal(id);
    // Antes esta rota mandava o usuário para /vet/consultas, longe da ficha
    // que ele estava preenchendo.
    res.redirect(`/vet/animal/${id}#medicamentos`);
  } catch (err) {
    next(err);
  }
});

router.post('/receita/:id/encerrar', async (req, res, next) => {
  try {
    const row = await db.get('SELECT animal_id FROM animal_medications WHERE id = ?', [req.params.id]);
    if (!row) return notFound(res);
    await db.run("UPDATE animal_medications SET status = 'concluído', end_date = date('now') WHERE id = ?", [
      req.params.id
    ]);
    res.redirect(`/vet/animal/${row.animal_id}#medicamentos`);
  } catch (err) {
    next(err);
  }
});

router.post('/animal/:id/document', uploadDocument.single('document'), verifyCsrf, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!req.file) return res.redirect(`/vet/animal/${id}?erro=documento`);

    await db.run(
      'INSERT INTO animal_documents (animal_id, filename, mimetype, data, description, uploaded_by) VALUES (?,?,?,?,?,?)',
      [
        id,
        req.file.originalname,
        req.file.mimetype,
        req.file.buffer,
        text(req.body.description, 200),
        req.session.user.id
      ]
    );
    res.redirect(`/vet/animal/${id}#documentos`);
  } catch (err) {
    next(err);
  }
});

// ── Exclusão de registros ────────────────────────────────────────────────────
// Não existia forma de apagar nada: um lançamento errado ficava eternamente na
// ficha do animal e contaminava os relatórios.
const DELETABLE = {
  saude: 'health_records',
  vacina: 'vaccines',
  vermifugacao: 'dewormings',
  procedimento: 'procedures',
  internacao: 'hospitalizations',
  foto: 'animal_photos',
  documento: 'animal_documents'
};

router.post('/registro/:tipo/:id/excluir', async (req, res, next) => {
  try {
    /*
     * O nome da tabela vem do mapa acima, nunca do parâmetro da URL — é o que
     * impede um :tipo malicioso de virar SQL.
     *
     * Object.hasOwn é obrigatório aqui: com acesso direto, :tipo = "constructor"
     * ou "toString" devolve a função herdada de Object.prototype, que é truthy,
     * passa pelo if e entra na query como texto — resultando em erro 500.
     */
    const tipo = String(req.params.tipo || '');
    if (!Object.hasOwn(DELETABLE, tipo)) return notFound(res);
    const table = DELETABLE[tipo];

    const row = await db.get(`SELECT animal_id FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!row) return notFound(res);

    await db.run(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
    res.redirect(`/vet/animal/${row.animal_id}`);
  } catch (err) {
    next(err);
  }
});

/*
 * Excluir o animal inteiro.
 *
 * Só havia exclusão dos registros da ficha (vacina, exame, foto…) — não do
 * animal, então um cadastro de teste ficava para sempre no sistema e ainda
 * contava nos relatórios.
 *
 * Os filhos são apagados explicitamente em vez de confiar no ON DELETE CASCADE:
 * o cascade do SQLite depende de PRAGMA foreign_keys estar ligado, e isso não é
 * garantia que valha em todo ambiente. Assim o resultado é o mesmo em qualquer lugar.
 */
router.post('/animal/:id/excluir', async (req, res, next) => {
  try {
    const id = req.params.id;
    const animal = await db.get('SELECT id, name FROM animals WHERE id = ?', [id]);
    if (!animal) return notFound(res, '/vet/animais');

    const filhos = [
      'health_records',
      'vaccines',
      'dewormings',
      'procedures',
      'hospitalizations',
      'animal_medications',
      'animal_photos',
      'animal_documents'
    ];

    // Tudo numa transação: ou some o animal e o histórico dele, ou não some nada.
    await db.batch([
      ...filhos.map((t) => ({ sql: `DELETE FROM ${t} WHERE animal_id = ?`, args: [id] })),
      { sql: 'DELETE FROM animals WHERE id = ?', args: [id] }
    ]);

    return res.redirect(`/vet/animais?ok=${encodeURIComponent(`${animal.name} foi excluído.`)}`);
  } catch (err) {
    next(err);
  }
});

// ── Histórico ────────────────────────────────────────────────────────────────
router.get('/animal/:id/historico', async (req, res, next) => {
  try {
    const id = req.params.id;
    const animal = await db.get('SELECT * FROM animals WHERE id = ?', [id]);
    if (!animal) return notFound(res);

    const [healthRecords, vaccines, dewormings, hospitalizations, procedures, medications] = await Promise.all([
      db.all('SELECT * FROM health_records WHERE animal_id = ? ORDER BY created_at DESC', [id]),
      db.all('SELECT * FROM vaccines WHERE animal_id = ? ORDER BY application_date DESC', [id]),
      db.all('SELECT * FROM dewormings WHERE animal_id = ? ORDER BY application_date DESC', [id]),
      db.all('SELECT * FROM hospitalizations WHERE animal_id = ? ORDER BY entry_date DESC', [id]),
      db.all('SELECT * FROM procedures WHERE animal_id = ? ORDER BY procedure_date DESC', [id]),
      db.all(
        `SELECT am.*, m.name AS medication_name FROM animal_medications am
         JOIN medications m ON m.id = am.medication_id
         WHERE am.animal_id = ? ORDER BY am.start_date DESC`,
        [id]
      )
    ]);

    // Uma linha do tempo única: sem isto era preciso ler cinco tabelas soltas
    // para entender o que aconteceu com o animal e em que ordem.
    const timeline = [
      ...healthRecords.map((r) => ({
        date: r.created_at,
        tipo: 'Saúde',
        icon: '❤️',
        titulo: `Peso ${r.weight ?? '—'} kg · ${r.body_condition || 'sem condição corporal'}`,
        detalhe: r.observations
      })),
      ...vaccines.map((r) => ({
        date: r.application_date,
        tipo: 'Vacina',
        icon: '💉',
        titulo: r.name,
        detalhe: r.batch ? `Lote ${r.batch}` : null
      })),
      ...dewormings.map((r) => ({
        date: r.application_date,
        tipo: 'Vermifugação',
        icon: '🪱',
        titulo: r.product,
        detalhe: r.dosage
      })),
      ...procedures.map((r) => ({
        date: r.procedure_date,
        tipo: 'Procedimento',
        icon: '🔬',
        titulo: r.name,
        detalhe: r.description
      })),
      ...hospitalizations.map((r) => ({
        date: r.entry_date,
        tipo: 'Internação',
        icon: '🏥',
        titulo: r.reason,
        detalhe: r.diagnosis
      })),
      ...medications.map((r) => ({
        date: r.start_date,
        tipo: 'Medicamento',
        icon: '💊',
        titulo: r.medication_name,
        detalhe: `${r.dosage} · ${r.frequency}`
      }))
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    res.render('vet/historico', { title: `Histórico de ${animal.name}`, animal, timeline });
  } catch (err) {
    next(err);
  }
});

// ── Consultas / internações ──────────────────────────────────────────────────
router.get('/consultas', async (req, res, next) => {
  try {
    const abertas = String(req.query.filtro || '') === 'abertas';
    const hoje = String(req.query.filtro || '') === 'hoje';

    const where = [];
    if (abertas) where.push('h.exit_date IS NULL');
    if (hoje) where.push("date(h.entry_date) = date('now')");

    const hospitalizations = await db.all(
      `SELECT h.*, a.name AS animal_name, a.species, u.name AS vet_name
       FROM hospitalizations h
       JOIN animals a ON h.animal_id = a.id
       LEFT JOIN users u ON h.responsible_vet = u.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY h.entry_date DESC`
    );

    res.render('vet/consultas', {
      title: 'Consultas e internações',
      hospitalizations,
      filtro: req.query.filtro || 'todas',
      statuses: STATUSES
    });
  } catch (err) {
    next(err);
  }
});

router.get('/consultas/hoje', (req, res) => res.redirect('/vet/consultas?filtro=hoje'));

// ── Medicamentos ─────────────────────────────────────────────────────────────
router.get('/medicamentos', async (req, res, next) => {
  try {
    const lowOnly = String(req.query.filtro || '') === 'baixo';
    const medications = await db.all(
      `SELECT m.*,
              (SELECT COUNT(*) FROM animal_medications am
               WHERE am.medication_id = m.id AND am.status = 'ativo') AS prescricoes_ativas
       FROM medications m
       ${lowOnly ? 'WHERE m.stock_quantity <= m.min_stock_level' : ''}
       ORDER BY m.name`
    );
    res.render('vet/medicamentos', { title: 'Medicamentos', medications, lowOnly });
  } catch (err) {
    next(err);
  }
});

router.get('/medicamentos/baixa', (req, res) => res.redirect('/vet/medicamentos?filtro=baixo'));

router.post('/medicamentos', async (req, res, next) => {
  try {
    const name = text(req.body.name, 100);
    if (!name) return res.redirect('/vet/medicamentos?erro=nome');

    await db.run(
      'INSERT INTO medications (name, description, stock_quantity, unit, min_stock_level) VALUES (?,?,?,?,?)',
      [
        name,
        text(req.body.description, 500),
        num(req.body.stock_quantity) ?? 0,
        text(req.body.unit, 20),
        num(req.body.min_stock_level) ?? 5
      ]
    );
    res.redirect('/vet/medicamentos');
  } catch (err) {
    next(err);
  }
});

router.post('/medicamentos/:id/estoque', async (req, res, next) => {
  try {
    const delta = num(req.body.delta);
    const absolute = num(req.body.stock_quantity);

    if (delta !== null) {
      // MAX(0, ...) no próprio UPDATE: dois ajustes simultâneos não conseguem
      // deixar o estoque negativo.
      await db.run('UPDATE medications SET stock_quantity = MAX(0, stock_quantity + ?) WHERE id = ?', [
        delta,
        req.params.id
      ]);
    } else if (absolute !== null) {
      await db.run('UPDATE medications SET stock_quantity = MAX(0, ?) WHERE id = ?', [absolute, req.params.id]);
    }
    res.redirect(`/vet/medicamentos${String(req.body.filtro || '') === 'baixo' ? '?filtro=baixo' : ''}`);
  } catch (err) {
    next(err);
  }
});

// ── Alertas ──────────────────────────────────────────────────────────────────
router.get('/alertas', async (req, res, next) => {
  try {
    const [vacinas, vermifugos, estoque, internados, semAmbiente] = await Promise.all([
      db.all(`
        SELECT v.id, v.name, v.next_dose, a.id AS animal_id, a.name AS animal_name, a.species
        FROM vaccines v JOIN animals a ON a.id = v.animal_id
        WHERE v.next_dose IS NOT NULL AND date(v.next_dose) <= date('now','+30 day')
          AND a.status != 'falecido'
        ORDER BY v.next_dose
      `),
      db.all(`
        SELECT d.id, d.product, d.next_application, a.id AS animal_id, a.name AS animal_name
        FROM dewormings d JOIN animals a ON a.id = d.animal_id
        WHERE d.next_application IS NOT NULL AND date(d.next_application) <= date('now','+30 day')
          AND a.status != 'falecido'
        ORDER BY d.next_application
      `),
      db.all('SELECT * FROM medications WHERE stock_quantity <= min_stock_level ORDER BY name'),
      db.all(`
        SELECT h.id, h.entry_date, h.reason, a.id AS animal_id, a.name AS animal_name
        FROM hospitalizations h JOIN animals a ON a.id = h.animal_id
        WHERE h.exit_date IS NULL ORDER BY h.entry_date
      `),
      db.all(`
        SELECT id, name, species FROM animals
        WHERE environment_id IS NULL AND status NOT IN ('adotado','falecido')
        ORDER BY name
      `)
    ]);

    res.render('vet/alertas', {
      title: 'Alertas',
      vacinas,
      vermifugos,
      estoque,
      internados,
      semAmbiente,
      totalAlertas: vacinas.length + vermifugos.length + estoque.length + internados.length
    });
  } catch (err) {
    next(err);
  }
});

// ── Relatórios ───────────────────────────────────────────────────────────────
router.get('/relatorios', async (req, res, next) => {
  try {
    const [resumo, porEspecie, porStatus, porAmbiente, estoqueBaixo] = await Promise.all([
      db.get(`
        SELECT
          (SELECT COUNT(*) FROM animals)                                          AS total_animais,
          (SELECT COUNT(*) FROM animals WHERE status = 'adotado')                 AS adotados,
          (SELECT COUNT(*) FROM animals WHERE neutered = 1)                       AS castrados,
          (SELECT COUNT(*) FROM animals WHERE LOWER(species)='gato'
             AND fiv_status = 'positivo')                                         AS fiv_positivos,
          (SELECT COUNT(*) FROM animals WHERE LOWER(species)='gato'
             AND felv_status = 'positivo')                                        AS felv_positivos,
          (SELECT COUNT(*) FROM vaccines
             WHERE strftime('%Y-%m', application_date) = strftime('%Y-%m','now')) AS vacinas_mes,
          (SELECT COUNT(*) FROM hospitalizations
             WHERE strftime('%Y-%m', entry_date) = strftime('%Y-%m','now'))       AS internacoes_mes,
          (SELECT COUNT(*) FROM procedures
             WHERE strftime('%Y-%m', procedure_date) = strftime('%Y-%m','now'))   AS procedimentos_mes
      `),
      db.all('SELECT species, COUNT(*) AS count FROM animals GROUP BY species ORDER BY count DESC'),
      db.all('SELECT status, COUNT(*) AS count FROM animals GROUP BY status ORDER BY count DESC'),
      db.all(`
        SELECT e.name, e.kind, COUNT(a.id) AS count, e.capacity
        FROM environments e LEFT JOIN animals a ON a.environment_id = e.id
        WHERE e.active = 1 GROUP BY e.id ORDER BY count DESC
      `),
      db.all('SELECT * FROM medications WHERE stock_quantity <= min_stock_level ORDER BY name')
    ]);

    const totalAnimais = resumo.total_animais || 0;
    res.render('vet/relatorios', {
      title: 'Relatórios',
      ...resumo,
      porEspecie,
      porStatus,
      porAmbiente,
      estoqueBaixo,
      maxEspecie: Math.max(1, ...porEspecie.map((r) => r.count)),
      maxStatus: Math.max(1, ...porStatus.map((r) => r.count)),
      totalAnimais
    });
  } catch (err) {
    next(err);
  }
});

// ── Meus registros ───────────────────────────────────────────────────────────
router.get('/meus-registros', async (req, res, next) => {
  try {
    const vetId = req.session.user.id;
    const [vacinas, procedimentos, receitas, internacoes] = await Promise.all([
      db.all(
        `SELECT v.*, a.name AS animal_name, a.species FROM vaccines v
         JOIN animals a ON a.id = v.animal_id WHERE v.veterinarian_id = ?
         ORDER BY v.application_date DESC LIMIT 100`,
        [vetId]
      ),
      db.all(
        `SELECT p.*, a.name AS animal_name, a.species FROM procedures p
         JOIN animals a ON a.id = p.animal_id WHERE p.veterinarian_id = ?
         ORDER BY p.procedure_date DESC LIMIT 100`,
        [vetId]
      ),
      db.all(
        `SELECT am.*, a.name AS animal_name, m.name AS medication_name FROM animal_medications am
         JOIN animals a ON a.id = am.animal_id JOIN medications m ON m.id = am.medication_id
         WHERE am.prescribed_by = ? ORDER BY am.start_date DESC LIMIT 100`,
        [vetId]
      ),
      db.all(
        `SELECT h.*, a.name AS animal_name FROM hospitalizations h
         JOIN animals a ON a.id = h.animal_id WHERE h.responsible_vet = ?
         ORDER BY h.entry_date DESC LIMIT 100`,
        [vetId]
      )
    ]);

    res.render('vet/meus_registros', {
      title: 'Meus registros',
      vacinas,
      procedimentos,
      receitas,
      internacoes
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
