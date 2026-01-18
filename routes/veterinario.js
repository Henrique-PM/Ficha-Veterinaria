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


router.get('/animal/photo/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT photo FROM animals WHERE id = ?', [id], (err, row) => {
    if (err || !row || !row.photo) {
      return res.status(404).send('Imagem não encontrada');
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(row.photo);
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


// Gerenciar animal
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
              return res.render('vet/ficha2', result);
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
     (animal_id, entry_date, reason, diagnosis, treatment, procedures, observations) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [animalId, entry_date, reason, diagnosis, treatment, procedures, observations],
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
  
  db.run(
    `INSERT INTO animals (name, species, breed, age, sex, photo, chip_number, status, characteristics, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, species, breed, age, sex, photoBuffer, chip_number, status, characteristics, description, veterinarian_id],
    function(err) {
      if (err) {
        console.error(err);
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


module.exports = router;