const express = require('express');
const router = express.Router();
const db = require('../database');
const bcrypt = require('bcrypt');
const saltRounds = 10;

// Login
router.get('/login', (req, res) => {
  res.render('auth/login');
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  db.get('SELECT * FROM users WHERE email = ? AND active = 1', [email], (err, user) => {
    if (err) {
      return res.status(500).send('Erro no servidor');
    }
    
    if (!user) {
      return res.status(401).render('auth/login', { error: 'Credenciais inválidas' });
    }
    
    bcrypt.compare(password, user.password, (err, result) => {
      if (result) {
        req.session.user = user;
        
        if (user.type === 'veterinario') {
          return res.redirect('/vet/animais');
        } else {
          return res.redirect('/user/dashboard');
        }
      } else {
        return res.status(401).render('auth/login', { error: 'Credenciais inválidas' });
      }
    });
  });
});

// Registro
router.get('/register', (req, res) => {
  res.render('auth/register');
});

router.post('/register', (req, res) => {
  const { name, email, password, type } = req.body;
  
  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
      return res.status(500).send('Erro ao criar usuário');
    }
    
    db.run(
      'INSERT INTO users (name, email, password, type) VALUES (?, ?, ?, ?)',
      [name, email, hash, type],
      function(err) {
        if (err) {
          return res.status(400).render('auth/register', { error: 'Email já cadastrado' });
        }
        
        res.redirect('/auth/login');
      }
    );
  });
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;