const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware para verificar se o usuário está autenticado e é do tipo veterinario
router.use((req, res, next) => {
  if (!req.session.user || req.session.user.type !== 'veterinario') {
    return res.redirect('/auth/login');
  }
  next();
});

// Dashboard do veterinário
router.get('/dashboard', (req, res) => {
  res.render('vet/animais', {
    user: req.session.user,
  });
});


router.get('/animal/photo/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT photo FROM animals WHERE id = ?', [id], (err, row) => {
    if (err || !row || !row.photo) {
      return res.status(404).send('Imagem não encontrada');
    }
    res.setHeader('Content-Type', 'image');
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
    
    db.get('SELECT * FROM health_records WHERE animal_id = ? ORDER BY updated_at DESC LIMIT 1', [animalId], (err, healthRecord) => {
      db.all('SELECT * FROM vaccines WHERE animal_id = ? ORDER BY application_date DESC', [animalId], (err, vaccines) => {
        db.all('SELECT * FROM hospitalizations WHERE animal_id = ? ORDER BY entry_date DESC', [animalId], (err, hospitalizations) => {
          res.render('vet/ficha', {
            user: req.session.user,
            animal,
            healthRecord,
            vaccines,
            hospitalizations
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
      
      res.redirect(`/vet/ficha/${animalId}`);
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
      
      res.redirect(`/vet/ficha/${animalId}`);
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
        res.redirect(`/vet/ficha/${animalId}`);
      });
    }
  );
});

router.get('/cadastrar-animal', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  
  res.render('vet/cadastra_animal', { 
    user: req.session.user
  });
});

router.post('/cadastrar-animal', upload.single('photo'), (req, res) => {
  const { name, species, breed, age, sex, description, characteristics, chip_number, status } = req.body;
  const veterinarian_id = req.session.user.id;

  const photoBuffer = req.file ? req.file.buffer : null;
//ta faltando preencher alguns campos como status 
  db.run(
    `INSERT INTO animals (name, species, breed, age, sex, photo, chip_number, status, characteristics, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, species, breed, age, sex, photoBuffer, chip_number, status, characteristics, description, veterinarian_id],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao cadastrar animal');
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