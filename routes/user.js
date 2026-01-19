const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const { ensureRole } = require('../middleware/auth');
const storage = multer.memoryStorage();
const uploadPhoto = multer({ storage });

// Middleware: apenas visualizador
router.use(ensureRole('visualizador'));

// Dashboard do usuário
router.get('/dashboard', (req, res) => {
  db.all('SELECT * FROM animals WHERE status != "falecido"', [], (err, animals) => {
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
      db.all('SELECT id, description, upload_date FROM animal_photos WHERE animal_id = ? ORDER BY upload_date DESC', [animalId], (pErr, photos) => {
        if (pErr) {
          console.error('Erro ao carregar fotos adicionais:', pErr);
        }
        res.render('user/ficha', {
          user: req.session.user,
          animal,
          healthRecord,
          photos: photos || []
        });
      });
    });
  });
});

// Upload de foto (usuário visualizador pode enviar foto para o animal)
router.post('/animal/:id/photo', uploadPhoto.single('photo'), (req, res) => {
  const animalId = req.params.id;
  if (!req.session || !req.session.user) return res.redirect('/auth/login');
  const uploadedBy = req.session.user.id;

  if (!req.file || !req.file.buffer) {
    return res.status(400).send('Arquivo de foto obrigatório');
  }

  const description = req.body.description || null;
  const photoBuffer = req.file.buffer;

  db.run(
    `INSERT INTO animal_photos (animal_id, photo, description, uploaded_by) VALUES (?, ?, ?, ?)`,
    [animalId, photoBuffer, description, uploadedBy],
    function (err) {
      if (err) {
        console.error('Erro ao salvar foto:', err);
        return res.status(500).send('Erro ao salvar foto');
      }
      return res.redirect(`/user/animal/${animalId}`);
    }
  );
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