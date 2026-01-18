const express = require('express');
const router = express.Router();
const db = require('../database');
const { ensureRole } = require('../middleware/auth');

// Middleware: apenas visualizador
router.use(ensureRole('visualizador'));

// Dashboard do usuário
router.get('/dashboard', (req, res) => {
  db.all('SELECT * FROM animals WHERE status != "adotado" AND status != "falecido"', [], (err, animals) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao buscar animais');
    }
    
    res.render('user/dashboard', { 
      user: req.session.user,
      animals 
    });
  });
});

// Visualizar animal específico
router.get('/animal/:id', (req, res) => {
  const animalId = req.params.id;
  
  db.get('SELECT * FROM animals WHERE id = ?', [animalId], (err, animal) => {
    if (err || !animal) {
      return res.status(404).send('Animal não encontrado');
    }
    
    db.get('SELECT * FROM health_records WHERE animal_id = ? ORDER BY updated_at DESC LIMIT 1', [animalId], (err, healthRecord) => {
      res.render('user/ficha', {
        user: req.session.user,
        animal,
        healthRecord
      });
    });
  });
});

router.get('/biblioteca-fotos', (req, res) => {
  const query = `SELECT id, name, species, breed, age, sex, photo, status FROM animals ORDER BY entry_date DESC`;
  db.all(query, [], (err, animals) => {
    if (err) {
      console.error(err);
      return res.status(500).render('error', { error: 'Erro ao carregar fotos' });
    }
    res.render('layouts/pesquisa_animais', {
      title: 'Biblioteca de Fotos',
      animals
    });
  });
});

module.exports = router;