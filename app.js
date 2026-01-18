const hbs = require('hbs'); 
const express = require('express');
const session = require('express-session');
const { engine } = require('express-handlebars');
const path = require('path');
const db = require('./database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const vetRoutes = require('./routes/veterinario');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');


const app = express();

app.disable('x-powered-by');

// Configurações
app.engine('hbs', engine({ extname: '.hbs', defaultLayout: 'main' }));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Segurança básica
app.use(helmet());

// Sessão
app.set('trust proxy', 1);

const cookieSecureFlag = String(process.env.COOKIE_SECURE || '').toLowerCase();
const isSecureCookie = cookieSecureFlag === 'true' || cookieSecureFlag === '1';

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('Defina SESSION_SECRET nas variáveis de ambiente em produção');
}

app.use(session({
  name: 'ficha.sid',
  secret: process.env.SESSION_SECRET || 'change_this_dev_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie,
    maxAge: 1000 * 60 * 60 * 4
  }
}));

// Rate limit básico para todo o app
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.use(globalLimiter);

// CSRF protection (baseado em sessão)
const csrfProtection = csrf();
app.use(csrfProtection);

// Locals úteis para as views
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.currentUser = req.session.user || null;
  next();
});

// Rotas
app.use('/auth', authLimiter, authRoutes);
app.use('/user', userRoutes);
app.use('/vet', vetRoutes);

// Rota inicial
app.get('/', (req, res) => {
  if (req.session.user) {
    if (req.session.user.type === 'veterinario') {
      return res.redirect('/vet/dashboard');
    } else {
      return res.redirect('/user/dashboard');
    }
  }
  res.render('auth/login');
});

// Rota pública para servir foto do animal
app.get('/animal/photo/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT photo FROM animals WHERE id = ?', [id], (err, row) => {
    if (err || !row || !row.photo) {
      return res.status(404).send('Imagem não encontrada');
    }
    res.setHeader('Content-Type', 'image');
    res.send(row.photo);
  });
});

// Middleware de erro
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Falha de verificação CSRF. Atualize a página.');
  }
  console.error(err.stack);
  res.status(500).send('Algo deu errado!');
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});