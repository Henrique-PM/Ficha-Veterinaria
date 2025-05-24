const express = require('express');
const router = express.Router();
const db = require('../database');

// Middleware para verificar se o usuário está autenticado e é do tipo veterinario
router.use((req, res, next) => {
  if (!req.session.user || req.session.user.type !== 'veterinario') {
    return res.redirect('/auth/login');
  }
  next();
});

// Dashboard do veterinário
router.get('/dashboard', (req, res) => {
  db.all(`
    SELECT a.*, 
           (SELECT COUNT(*) FROM health_records WHERE animal_id = a.id) as records_count,
           (SELECT COUNT(*) FROM vaccines WHERE animal_id = a.id) as vaccines_count
    FROM animals a
    WHERE a.status != "adotado" AND a.status != "falecido"
  `, [], (err, animals) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao buscar animais');
    }
    
    res.render('vet/animais', { 
      user: req.session.user,
      animals 
    });
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

module.exports = router;