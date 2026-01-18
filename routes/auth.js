const express = require('express');
const router = express.Router();
const db = require('../database');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const saltRounds = 10;

// Login
router.get('/login', (req, res) => {
  res.render('auth/login');
});

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('E-mail inválido').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Senha inválida'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('auth/login', { error: errors.array()[0].msg });
    }

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
  }
);

// Registro
router.get('/register', (req, res) => {
  res.render('auth/register');
});

router.post(
  '/register',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Nome inválido'),
    body('email').isEmail().withMessage('E-mail inválido').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Senha muito curta (mín. 8)'),
    body('type').isIn(['veterinario', 'visualizador']).withMessage('Tipo de usuário inválido')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('auth/register', { error: errors.array()[0].msg });
    }

    const { name, email, password, type } = req.body;
    bcrypt.hash(password, saltRounds, (err, hash) => {
      if (err) {
        return res.status(500).render('auth/register', { error: 'Erro ao criar usuário' });
      }
      db.run(
        'INSERT INTO users (name, email, password, type) VALUES (?, ?, ?, ?)',
        [name, email, hash, type],
        function (err) {
          if (err) {
            return res.status(400).render('auth/register', { error: 'Email já cadastrado' });
          }
          res.redirect('/auth/login');
        }
      );
    });
  }
);

// Logout
router.get('/logout', (req, res) => {
  const secureCookie = req.secure || req.headers['x-forwarded-proto'] === 'https';

  req.session.destroy(() => {
    res.clearCookie('ficha.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie
    });
    res.redirect('/');
  });
});

module.exports = router;