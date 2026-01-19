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
      return res.status(500).render('auth/login', { error: 'Erro no servidor' });
    }
    if (!user) {
      return res.status(401).render('auth/login', { error: 'Credenciais inválidas' });
    }
    bcrypt.compare(password, user.password, (compareErr, result) => {
      if (compareErr) {
        return res.status(500).render('auth/login', { error: 'Erro no servidor' });
      }

      if (!result) {
        return res.status(401).render('auth/login', { error: 'Credenciais inválidas' });
      }

      req.session.regenerate((sessionErr) => {
        if (sessionErr) {
          return res.status(500).render('auth/login', { error: 'Erro ao iniciar sessão' });
        }

        req.session.user = { id: user.id, name: user.name, email: user.email, type: user.type };
        req.session.save((saveErr) => {
          if (saveErr) {
            return res.status(500).render('auth/login', { error: 'Erro ao salvar sessão' });
          }

          if (user.type === 'veterinario') {
            return res.redirect('/vet/dashboard');
          }
          return res.redirect('/user/dashboard');
        });
      });
    });
  });
});

// Registro
router.get('/register', (req, res) => {
  res.render('auth/register');
});

router.post('/register', (req, res) => {
  const { name, email, password, type } = req.body;

  // Validações básicas
  if (!name || !email || !password || !type) {
    return res.status(400).render('auth/register', { error: 'Todos os campos são obrigatórios' });
  }

  // Verificar se email já existe
  db.get('SELECT id FROM users WHERE email = ?', [email], (checkErr, existingUser) => {
    if (checkErr) {
      return res.status(500).render('auth/register', { error: 'Erro no servidor' });
    }
    if (existingUser) {
      return res.status(400).render('auth/register', { error: 'Email já cadastrado' });
    }

    // Hash da senha
    bcrypt.hash(password, saltRounds, (hashErr, hash) => {
      if (hashErr) {
        return res.status(500).render('auth/register', { error: 'Erro ao criar usuário' });
      }

      // Inserir novo usuário
      db.run(
        'INSERT INTO users (name, email, password, type, active) VALUES (?, ?, ?, ?, 1)',
        [name, email, hash, type],
        function (insertErr) {
          if (insertErr) {
            console.error('Erro ao inserir usuário:', insertErr);
            return res.status(500).render('auth/register', { error: 'Erro ao criar usuário' });
          }
          res.redirect('/auth/login');
        }
      );
    });
  });
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ficha.sid', {
      httpOnly: true,
      sameSite: 'lax'
    });
    res.redirect('/');
  });
});

module.exports = router;