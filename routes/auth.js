const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const db = require('../database');
const { killSessionsForUser } = require('../lib/session-store');

const router = express.Router();
const SALT_ROUNDS = 10;
const MIN_PASSWORD = 8;

// Freio específico para as rotas de credencial. O limite global (600/15min) é
// alto demais para segurar tentativa de senha por força bruta.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    res.status(429).render('auth/login', {
      layout: 'blank',
      error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.'
    })
});

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function homeFor(user) {
  return user.type === 'visualizador' ? '/user/dashboard' : '/vet/dashboard';
}

// ── Login ────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user));
  res.render('auth/login', { layout: 'blank' });
});

router.post('/login', credentialLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    const user = await db.get(
      'SELECT id, name, email, password, type FROM users WHERE email = ? AND active = 1',
      [email]
    );

    // Mesma mensagem para e-mail inexistente e senha errada: dizer qual dos dois
    // falhou entrega ao atacante a lista de e-mails válidos do sistema.
    const invalid = () =>
      res.status(401).render('auth/login', { layout: 'blank', error: 'E-mail ou senha inválidos.' });

    if (!user) {
      // Hash descartável só para gastar o mesmo tempo do caminho válido e não
      // permitir descobrir e-mails cadastrados pela diferença de resposta.
      await bcrypt.compare(password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
      return invalid();
    }

    if (!(await bcrypt.compare(password, user.password))) return invalid();

    // Sessão nova a cada login, para não deixar um id de sessão anterior valer
    // depois da autenticação (session fixation).
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, name: user.name, email: user.email, type: user.type };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        return res.redirect(homeFor(user));
      });
    });
  } catch (err) {
    next(err);
  }
});

// ── Cadastro ─────────────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user));
  res.render('auth/register', { layout: 'blank' });
});

router.post('/register', credentialLimiter, async (req, res, next) => {
  const fail = (message, status = 400) =>
    res.status(status).render('auth/register', {
      layout: 'blank',
      error: message,
      form: { name: req.body.name, email: req.body.email }
    });

  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!name || !email || !password) return fail('Preencha todos os campos obrigatórios.');
    if (name.length > 120) return fail('Nome longo demais.');
    if (!isValidEmail(email)) return fail('E-mail inválido.');
    if (password.length < MIN_PASSWORD) return fail(`A senha precisa ter ao menos ${MIN_PASSWORD} caracteres.`);
    if (password.length > 200) return fail('Senha longa demais.');

    /*
     * O papel NUNCA vem do cliente.
     *
     * Antes o formulário tinha um <select> com "Veterinário" e a rota gravava
     * o que chegasse: qualquer visitante virava veterinário e via prontuário,
     * documentos e dados clínicos de todos os animais.
     *
     * Agora todo cadastro nasce visualizador, sem exceção. Virar veterinário
     * só acontece por promoção feita por alguém da equipe, em /vet/equipe.
     */
    const type = 'visualizador';

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return fail('E-mail já cadastrado.');

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { lastID } = await db.run(
      'INSERT INTO users (name, email, password, type, active) VALUES (?, ?, ?, ?, 1)',
      [name, email, hash, type]
    );

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: lastID, name, email, type };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        return res.redirect(homeFor({ type }));
      });
    });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return fail('E-mail já cadastrado.');
    next(err);
  }
});

// ── Troca da própria senha ───────────────────────────────────────────────────
// Faltava por completo: a senha inicial do root (que vem de variável de
// ambiente) não tinha como ser trocada de dentro do sistema.
router.get('/senha', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  res.render('auth/senha', { title: 'Alterar senha' });
});

router.post('/senha', credentialLimiter, async (req, res, next) => {
  if (!req.session.user) return res.redirect('/auth/login');

  const fail = (message) => res.status(400).render('auth/senha', { title: 'Alterar senha', error: message });

  try {
    const atual = String(req.body.current_password || '');
    const nova = String(req.body.new_password || '');
    const confirma = String(req.body.confirm_password || '');

    if (nova.length < MIN_PASSWORD) return fail(`A nova senha precisa ter ao menos ${MIN_PASSWORD} caracteres.`);
    if (nova !== confirma) return fail('A confirmação não confere com a nova senha.');
    if (nova === atual) return fail('A nova senha precisa ser diferente da atual.');

    const user = await db.get('SELECT id, password FROM users WHERE id = ?', [req.session.user.id]);
    if (!user || !(await bcrypt.compare(atual, user.password))) return fail('Senha atual incorreta.');

    await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(nova, SALT_ROUNDS), user.id]);

    /*
     * Trocar a senha tem que expulsar quem estava logado com a senha antiga.
     *
     * Sem isto, alguém que tivesse obtido a senha continuava dentro do sistema
     * por até 8 horas mesmo depois da vítima trocá-la — que é justamente a ação
     * que a pessoa faz para se livrar do invasor. A redefinição feita pelo
     * administrador já derrubava as sessões; a troca pelo próprio usuário não.
     *
     * Derrubamos todas e criamos uma nova para quem acabou de trocar, para a
     * pessoa não ser deslogada da própria tela.
     */
    const { id, name, email, type } = req.session.user;
    await killSessionsForUser(user.id);

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id, name, email, type };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        return res.render('auth/senha', {
          title: 'Alterar senha',
          sucesso: 'Senha alterada. As outras sessões desta conta foram encerradas.'
        });
      });
    });
  } catch (err) {
    next(err);
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────
// POST, e não GET: com logout em GET basta um <img src="/auth/logout"> em
// qualquer página para deslogar quem estiver navegando.
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ficha.sid', { httpOnly: true, sameSite: 'lax' });
    res.redirect('/auth/login');
  });
});

module.exports = router;
