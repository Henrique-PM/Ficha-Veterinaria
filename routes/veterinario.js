const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const { ensureRole } = require('../middleware/auth');
const storage = multer.memoryStorage();

const uploadAnimalPhoto = multer({ storage });
const uploadDocument = multer({ storage });

// Middleware: apenas veterinário
router.use(ensureRole('veterinario'));

// Diagnóstico rápido do mount
router.get('/ping', (req, res) => {
  res.send('vet ok');
});

// Dashboard do veterinário
router.get('/dashboard', (req, res) => {
  const stats = {};
  const queries = {
    total_animais: 'SELECT COUNT(*) as c FROM animals',
    em_tratamento: "SELECT COUNT(*) as c FROM animals WHERE status IN ('hospital','clinica')",
    vacinas_pendentes: "SELECT COUNT(*) as c FROM vaccines WHERE date(next_dose) <= date('now')",
    animais_adotados: "SELECT COUNT(*) as c FROM animals WHERE status='adotado'",
    total_cavalos: "SELECT COUNT(*) as c FROM animals WHERE species='cavalo'",
    total_gatos: "SELECT COUNT(*) as c FROM animals WHERE species='gato'",
    consultas_hoje: "SELECT COUNT(*) as c FROM hospitalizations WHERE date(entry_date)=date('now')",
    fichas_atualizadas_hoje: "SELECT COUNT(*) as c FROM health_records WHERE date(updated_at)=date('now')",
    medicamentos_baixos: "SELECT COUNT(*) as c FROM medications WHERE stock_quantity <= min_stock_level"
  };

  const keys = Object.keys(queries);
  let remaining = keys.length;

  keys.forEach(k => {
    db.get(queries[k], [], (err, row) => {
      stats[k] = row ? row.c : 0;
      if (--remaining === 0) {
        db.all('SELECT * FROM animals ORDER BY entry_date DESC LIMIT 20', [], (e2, animals) => {
          return res.render('vet/animais', { user: req.session.user, animals: animals || [], ...stats });
        });
      }
    });
  });
});

router.get('/search', (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.redirect('/vet/dashboard'); // Redireciona se a busca estiver vazia
  }

  const query = `SELECT * FROM animals WHERE name LIKE ?`;
  const params = [`%${name}%`];

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao buscar animais');
    }

    res.render('vet/animais', { user: req.session.user, animals: rows });
  });
});

// Listas filtradas de animais - ANTES de /animal/:id para evitar conflito
router.get('/animais/tratamento', (req, res) => {
  const q = `SELECT id, name, species, breed, age, sex, photo, status
             FROM animals WHERE status IN ('hospital','clinica')
             ORDER BY entry_date DESC`;
  db.all(q, [], (err, animals) => {
    if (err) return res.status(500).send('Erro ao carregar animais em tratamento');
    res.render('layouts/pesquisa_animais', {
      title: 'Animais em Tratamento',
      animals: animals || [],
      user: req.session.user
    });
  });
});

router.get('/animais/adotados', (req, res) => {
  const q = `SELECT id, name, species, breed, age, sex, photo, status
             FROM animals WHERE status='adotado'
             ORDER BY entry_date DESC`;
  db.all(q, [], (err, animals) => {
    if (err) return res.status(500).send('Erro ao carregar animais adotados');
    res.render('layouts/pesquisa_animais', {
      title: 'Animais Adotados',
      animals: animals || [],
      user: req.session.user
    });
  });
});

router.get('/animais/especie/:species', (req, res) => {
  const { species } = req.params;
  const q = `SELECT id, name, species, breed, age, sex, photo, status
             FROM animals WHERE LOWER(species)=LOWER(?)
             ORDER BY entry_date DESC`;
  db.all(q, [species], (err, animals) => {
    if (err) return res.status(500).send('Erro ao carregar animais por espécie');
    res.render('layouts/pesquisa_animais', {
      title: `Animais: ${species}`,
      animals: animals || [],
      user: req.session.user
    });
  });
});

// Rotas de atalho para seções da ficha
router.get('/animal/:id/consulta', (req, res) => {
  return res.redirect(`/vet/animal/${req.params.id}#ficha`);
});

router.get('/animal/:id/vacina', (req, res) => {
  return res.redirect(`/vet/animal/${req.params.id}#vacina`);
});

router.get('/animal/:id/internacao', (req, res) => {
  return res.redirect(`/vet/animal/${req.params.id}#internacao`);
});

router.get('/animal/:id/historico', (req, res) => {
  const animalId = req.params.id;

  db.get('SELECT * FROM animals WHERE id = ?', [animalId], (err, animal) => {
    if (err || !animal) {
      return res.status(404).send('Animal não encontrado');
    }

    const result = { user: req.session.user, animal };

    db.all('SELECT * FROM health_records WHERE animal_id = ? ORDER BY updated_at DESC', [animalId], (err, healthRecords) => {
      result.healthRecords = healthRecords || [];

      db.all('SELECT * FROM vaccines WHERE animal_id = ? ORDER BY application_date DESC', [animalId], (err, vaccines) => {
        result.vaccines = vaccines || [];

        db.all('SELECT * FROM hospitalizations WHERE animal_id = ? ORDER BY entry_date DESC', [animalId], (err, hospitalizations) => {
          result.hospitalizations = hospitalizations || [];

          db.all('SELECT * FROM procedures WHERE animal_id = ? ORDER BY procedure_date DESC', [animalId], (err, procedures) => {
            result.procedures = procedures || [];

            res.render('vet/historico', result);
          });
        });
      });
    });
  });
});

// Download de documento - rota específica antes de /animal/:id
router.get('/animal/:animalId/document/:docId', (req, res) => {
  const { animalId, docId } = req.params;
  db.get('SELECT filename, mimetype, data FROM animal_documents WHERE id = ? AND animal_id = ?', [docId, animalId], (err, row) => {
    if (err || !row) return res.status(404).send('Documento não encontrado');
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
    res.setHeader('Content-Type', row.mimetype);
    return res.send(row.data);
  });
});

// Foto do animal - rota específica antes de /animal/:id
router.get('/animal/photo/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT photo FROM animals WHERE id = ?', [id], (err, row) => {
    if (err || !row || !row.photo) {
      return res.status(404).send('Imagem não encontrada');
    }
    // Definir Content-Type padrão para imagens
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(row.photo);
  });
});

// Atualizar foto principal do animal
router.post('/animal/:id/photo', uploadAnimalPhoto.single('photo'), (req, res) => {
  const { id } = req.params;

  if (!req.file || !req.file.buffer) {
    return res.status(400).send('Arquivo de foto é obrigatório');
  }

  db.run('UPDATE animals SET photo = ? WHERE id = ?', [req.file.buffer, id], function (err) {
    if (err) {
      console.error('Erro ao atualizar foto:', err);
      return res.status(500).send('Erro ao atualizar foto');
    }
    return res.redirect(`/vet/animal/${id}`);
  });
});

// Gerenciar animal - rota genérica por último
router.get('/animal/:id', (req, res) => {
  const animalId = req.params.id;

  db.get('SELECT * FROM animals WHERE id = ?', [animalId], (err, animal) => {
    if (err || !animal) {
      return res.status(404).send('Animal não encontrado');
    }

    const result = { user: req.session.user, animal };

    db.get('SELECT * FROM health_records WHERE animal_id = ? ORDER BY updated_at DESC LIMIT 1', [animalId], (err, healthRecord) => {
      result.healthRecord = healthRecord || null;

      db.all('SELECT * FROM vaccines WHERE animal_id = ? ORDER BY application_date DESC', [animalId], (err, vaccines) => {
        result.vaccines = vaccines || [];

        db.all('SELECT * FROM hospitalizations WHERE animal_id = ? ORDER BY entry_date DESC', [animalId], (err, hospitalizations) => {
          result.hospitalizations = hospitalizations || [];

          db.all('SELECT * FROM procedures WHERE animal_id = ? ORDER BY procedure_date DESC', [animalId], (err, procedures) => {
            result.procedures = procedures || [];

            db.all('SELECT id, filename, description, upload_date FROM animal_documents WHERE animal_id = ? ORDER BY upload_date DESC', [animalId], (err, documents) => {
              result.documents = documents || [];
              db.all('SELECT id, description, upload_date FROM animal_photos WHERE animal_id = ? ORDER BY upload_date DESC', [animalId], (pErr, photos) => {
                result.photos = photos || [];
                // Carregar medicamentos do animal (com nome)
                const qMeds = `
                  SELECT am.id, am.dosage, am.frequency, am.start_date, am.end_date, m.name AS medication_name
                  FROM animal_medications am
                  JOIN medications m ON am.medication_id = m.id
                  WHERE am.animal_id = ?
                  ORDER BY am.start_date DESC
                `;
                db.all(qMeds, [animalId], (mErr, medications) => {
                  result.medications = medications || [];
                  return res.render('vet/ficha', result);
                });
              });
            });
          });
        });
      });
    });
  });
});

// Adicionar/Atualizar ficha de saúde
router.post('/animal/:id/health-record', (req, res) => {
  const animalId = req.params.id;
  const { weight, body_condition, observations, allergies } = req.body;
  
  db.run(
    `INSERT INTO health_records 
     (animal_id, weight, body_condition, observations, allergies) 
     VALUES (?, ?, ?, ?, ?)`,
    [animalId, weight, body_condition, observations, allergies],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao salvar ficha de saúde');
      }
      
      res.redirect(`/vet/animal/${animalId}`);
    }
  );
});

// Adicionar vacina
router.post('/animal/:id/vaccine', (req, res) => {
  const animalId = req.params.id;
  const { name, application_date, next_dose, batch, observations } = req.body;
  
  db.run(
    `INSERT INTO vaccines 
     (animal_id, name, application_date, next_dose, batch, veterinarian_id, observations) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [animalId, name, application_date, next_dose, batch, req.session.user.id, observations],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao registrar vacina');
      }
      
      res.redirect(`/vet/animal/${animalId}`);
    }
  );
});

// Registrar internação
router.post('/animal/:id/hospitalization', (req, res) => {
  const animalId = req.params.id;
  const { entry_date, reason, diagnosis, treatment, procedures, observations } = req.body;
  
  db.run(
    `INSERT INTO hospitalizations 
     (animal_id, entry_date, reason, diagnosis, treatment, procedures, observations, responsible_vet) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [animalId, entry_date, reason, diagnosis, treatment, procedures, observations, req.session.user.id],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao registrar internação');
      }
      
      // Atualizar status do animal para "hospital"
      db.run('UPDATE animals SET status = "hospital" WHERE id = ?', [animalId], (err) => {
        if (err) console.error(err);
        res.redirect(`/vet/animal/${animalId}`);
      });
    }
  );
});

// Registrar procedimento/exame
router.post('/animal/:id/procedure', (req, res) => {
  const animalId = req.params.id;
  const { name, procedure_date, description, observations } = req.body;

  db.run(
    `INSERT INTO procedures (animal_id, name, procedure_date, description, veterinarian_id, observations)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [animalId, name, procedure_date, description, req.session.user.id, observations],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao registrar procedimento');
      }
      return res.redirect(`/vet/animal/${animalId}`);
    }
  );
});

// Salvar receita/medicamento
router.post('/animal/:id/receita', (req, res) => {
  const animalId = req.params.id;
  const { medication_name, dosage, frequency, start_date, end_date, notes } = req.body;

  if (!medication_name || !dosage || !frequency || !start_date) {
    return res.status(400).send('Campos obrigatórios ausentes');
  }

  // Encontrar ou criar o medicamento por nome
  db.get('SELECT id FROM medications WHERE LOWER(name) = LOWER(?)', [medication_name], (findErr, med) => {
    if (findErr) {
      console.error('Erro ao buscar medicamento:', findErr);
      return res.status(500).send('Erro ao salvar receita');
    }

    const insertAnimalMedication = (medicationId) => {
      db.run(
        `INSERT INTO animal_medications (animal_id, medication_id, dosage, frequency, start_date, end_date, prescribed_by, observations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [animalId, medicationId, dosage, frequency, start_date, end_date || null, req.session.user.id, notes || null],
        function (err) {
          if (err) {
            console.error('Erro ao inserir receita:', err);
            return res.status(500).send('Erro ao salvar receita');
          }
          return res.redirect(`/vet/consultas`);
        }
      );
    };

    if (med && med.id) {
      insertAnimalMedication(med.id);
    } else {
      // Criar medicamento simples com nome
      db.run(
        `INSERT INTO medications (name) VALUES (?)`,
        [medication_name],
        function (createErr) {
          if (createErr) {
            console.error('Erro ao criar medicamento:', createErr);
            return res.status(500).send('Erro ao salvar receita');
          }
          insertAnimalMedication(this.lastID);
        }
      );
    }
  });
});

// Upload de documento
router.post('/animal/:id/document', uploadDocument.single('document'), (req, res) => {
  const animalId = req.params.id;

  if (!req.file) {
    return res.status(400).redirect(`/vet/animal/${animalId}`);
  }

  const { originalname, mimetype, buffer } = req.file;
  const { description } = req.body;

  db.run(
    `INSERT INTO animal_documents (animal_id, filename, mimetype, data, description, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [animalId, originalname, mimetype, buffer, description, req.session.user.id],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao salvar documento');
      }
      return res.redirect(`/vet/animal/${animalId}`);
    }
  );
});

// Download de documento
router.get('/animal/:animalId/document/:docId', (req, res) => {
  const { animalId, docId } = req.params;
  db.get('SELECT filename, mimetype, data FROM animal_documents WHERE id = ? AND animal_id = ?', [docId, animalId], (err, row) => {
    if (err || !row) return res.status(404).send('Documento não encontrado');
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
    res.setHeader('Content-Type', row.mimetype);
    return res.send(row.data);
  });
});

router.get('/cadastrar-animal', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  
  res.render('vet/cadastra_animal', { 
    user: req.session.user
  });
});

router.post('/cadastrar-animal', uploadAnimalPhoto.single('photo'), (req, res) => {
  const { name, species, breed, age, sex, description, characteristics, chip_number, status } = req.body;
  const veterinarian_id = req.session.user.id;

  const photoBuffer = req.file ? req.file.buffer : null;
  const chipValue = chip_number && chip_number.trim() !== '' ? chip_number.trim() : null; // null evita conflito de UNIQUE com string vazia
  
  db.run(
    `INSERT INTO animals (name, species, breed, age, sex, photo, chip_number, status, characteristics, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, species, breed, age, sex, photoBuffer, chipValue, status, characteristics, description, veterinarian_id],
    function(err) {
      if (err) {
        console.error(err);
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(400).render('vet/cadastra_animal', { user: req.session.user, error: 'Chip já cadastrado. Use outro número ou deixe em branco.' });
        }
        return res.status(500).render('vet/cadastra_animal', { user: req.session.user, error: 'Erro ao cadastrar animal' });
      }

      res.redirect(`/vet/animal/${this.lastID}`);
    }
  );
});


router.get('/biblioteca', (req, res) => {
  const query = `
    SELECT id, name, species, breed, age, sex, photo, status
    FROM animals
    ORDER BY entry_date DESC
  `;

  db.all(query, [], (err, animals) => {
    if (err) {
      console.error('Erro ao buscar animais:', err);
      return res.status(500).render('error', { error: 'Erro ao carregar biblioteca de animais.' });
    }

    res.render('layouts/pesquisa_animais', {
      title: 'Biblioteca de Fotos',
      animals,
      user: req.session.user || null
    });
  });
});

// Página de consultas/internações
router.get('/consultas', (req, res) => {
  const query = `
    SELECT h.*, a.name as animal_name, a.species, u.name as vet_name
    FROM hospitalizations h
    JOIN animals a ON h.animal_id = a.id
    LEFT JOIN users u ON h.responsible_vet = u.id
    ORDER BY h.entry_date DESC
  `;

  db.all(query, [], (err, hospitalizations) => {
    if (err) {
      console.error('Erro ao buscar consultas:', err);
      return res.status(500).send('Erro ao carregar consultas');
    }

    res.render('vet/consultas', {
      user: req.session.user,
      hospitalizations
    });
  });
});

// Consultas de hoje
router.get('/consultas/hoje', (req, res) => {
  const query = `
    SELECT h.*, a.name as animal_name, a.species, u.name as vet_name
    FROM hospitalizations h
    JOIN animals a ON h.animal_id = a.id
    LEFT JOIN users u ON h.responsible_vet = u.id
    WHERE date(h.entry_date) = date('now')
    ORDER BY h.entry_date DESC
  `;
  db.all(query, [], (err, hospitalizations) => {
    if (err) {
      console.error('Erro ao buscar consultas de hoje:', err);
      return res.status(500).send('Erro ao carregar consultas de hoje');
    }
    res.render('vet/consultas', {
      user: req.session.user,
      hospitalizations,
      todayOnly: true
    });
  });
});

// Página de medicamentos
router.get('/medicamentos', (req, res) => {
  db.all('SELECT * FROM medications ORDER BY name', [], (err, medications) => {
    if (err) {
      console.error('Erro ao buscar medicamentos:', err);
      return res.status(500).send('Erro ao carregar medicamentos');
    }

    res.render('vet/medicamentos', {
      user: req.session.user,
      medications
    });
  });
});

// Medicamentos com estoque baixo
router.get('/medicamentos/baixa', (req, res) => {
  db.all('SELECT * FROM medications WHERE stock_quantity <= min_stock_level ORDER BY name', [], (err, medications) => {
    if (err) {
      console.error('Erro ao buscar medicamentos baixos:', err);
      return res.status(500).send('Erro ao carregar medicamentos');
    }
    res.render('vet/medicamentos', { user: req.session.user, medications, lowOnly: true });
  });
});

// Adicionar medicamento
router.post('/medicamentos', (req, res) => {
  const { name, description, stock_quantity, unit, min_stock_level } = req.body;
  
  db.run(
    'INSERT INTO medications (name, description, stock_quantity, unit, min_stock_level) VALUES (?, ?, ?, ?, ?)',
    [name, description, stock_quantity, unit, min_stock_level],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao adicionar medicamento');
      }
      res.redirect('/vet/medicamentos');
    }
  );
});

// Atualizar estoque de medicamento
router.post('/medicamentos/:id/atualizar-estoque', (req, res) => {
  const { id } = req.params;
  const { stock_quantity } = req.body;
  
  db.run('UPDATE medications SET stock_quantity = ? WHERE id = ?', [stock_quantity, id], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao atualizar estoque');
    }
    res.redirect('/vet/medicamentos');
  });
});

// Fichas atualizadas hoje
router.get('/fichas/hoje', (req, res) => {
  const q = `
    SELECT hr.*, a.name AS animal_name, a.species
    FROM health_records hr
    JOIN animals a ON hr.animal_id = a.id
    WHERE date(hr.updated_at) = date('now')
    ORDER BY hr.updated_at DESC
  `;
  db.all(q, [], (err, fichas) => {
    if (err) return res.status(500).send('Erro ao carregar fichas de hoje');
    res.render('vet/fichas', { user: req.session.user, fichas });
  });
});

// Página de relatórios
router.get('/relatorios', (req, res) => {
  const stats = {};
  
  const queries = {
    total_animais: 'SELECT COUNT(*) as count FROM animals',
    por_especie: 'SELECT species, COUNT(*) as count FROM animals GROUP BY species',
    por_status: 'SELECT status, COUNT(*) as count FROM animals GROUP BY status',
    vacinas_mes: "SELECT COUNT(*) as count FROM vaccines WHERE strftime('%Y-%m', application_date) = strftime('%Y-%m', 'now')",
    consultas_mes: "SELECT COUNT(*) as count FROM hospitalizations WHERE strftime('%Y-%m', entry_date) = strftime('%Y-%m', 'now')",
    animais_adotados: "SELECT COUNT(*) as count FROM animals WHERE status = 'adotado'",
    medicamentos_baixos: 'SELECT * FROM medications WHERE stock_quantity <= min_stock_level'
  };

  let completed = 0;
  const total = Object.keys(queries).length;

  Object.keys(queries).forEach(key => {
    if (key === 'por_especie' || key === 'por_status' || key === 'medicamentos_baixos') {
      db.all(queries[key], [], (err, rows) => {
        stats[key] = rows || [];
        if (++completed === total) {
          res.render('vet/relatorios', { user: req.session.user, ...stats });
        }
      });
    } else {
      db.get(queries[key], [], (err, row) => {
        stats[key] = row ? row.count : 0;
        if (++completed === total) {
          res.render('vet/relatorios', { user: req.session.user, ...stats });
        }
      });
    }
  });
});

// Meus registros do veterinário
router.get('/meus-registros', (req, res) => {
  const vetId = req.session.user.id;
  const result = { user: req.session.user };

  const qVacinas = `
    SELECT v.*, a.name AS animal_name, a.species
    FROM vaccines v
    JOIN animals a ON v.animal_id = a.id
    WHERE v.veterinarian_id = ?
    ORDER BY v.application_date DESC
  `;
  const qProcedures = `
    SELECT p.*, a.name AS animal_name, a.species
    FROM procedures p
    JOIN animals a ON p.animal_id = a.id
    WHERE p.veterinarian_id = ?
    ORDER BY p.procedure_date DESC
  `;
  const qReceitas = `
    SELECT am.*, a.name AS animal_name, a.species, m.name AS medication_name
    FROM animal_medications am
    JOIN animals a ON am.animal_id = a.id
    JOIN medications m ON am.medication_id = m.id
    WHERE am.prescribed_by = ?
    ORDER BY am.start_date DESC
  `;

  db.all(qVacinas, [vetId], (e1, vacinas) => {
    result.vacinas = vacinas || [];
    db.all(qProcedures, [vetId], (e2, procedimentos) => {
      result.procedimentos = procedimentos || [];
      db.all(qReceitas, [vetId], (e3, receitas) => {
        result.receitas = receitas || [];
        return res.render('vet/meus_registros', result);
      });
    });
  });
});

// Histórico completo do animal
router.get('/animal/:id/historico', (req, res) => {
  const animalId = req.params.id;

  db.get('SELECT * FROM animals WHERE id = ?', [animalId], (err, animal) => {
    if (err || !animal) {
      return res.status(404).send('Animal não encontrado');
    }

    const result = { user: req.session.user, animal };

    db.all('SELECT * FROM health_records WHERE animal_id = ? ORDER BY updated_at DESC', [animalId], (err, healthRecords) => {
      result.healthRecords = healthRecords || [];

      db.all('SELECT * FROM vaccines WHERE animal_id = ? ORDER BY application_date DESC', [animalId], (err, vaccines) => {
        result.vaccines = vaccines || [];

        db.all('SELECT * FROM hospitalizations WHERE animal_id = ? ORDER BY entry_date DESC', [animalId], (err, hospitalizations) => {
          result.hospitalizations = hospitalizations || [];

          db.all('SELECT * FROM procedures WHERE animal_id = ? ORDER BY procedure_date DESC', [animalId], (err, procedures) => {
            result.procedures = procedures || [];

            res.render('vet/historico', result);
          });
        });
      });
    });
  });
});

module.exports = router;