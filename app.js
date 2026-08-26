const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { engine } = require('express-handlebars');

const helpers = require('./lib/helpers');
const DbSessionStore = require('./lib/session-store');
const { ensureSchema } = require('./db/schema');
const { csrfToken, checkCsrf } = require('./middleware/csrf');
const { uploadErrorHandler } = require('./middleware/uploads');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const vetRoutes = require('./routes/veterinario');
const mediaRoutes = require('./routes/media');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// ── Views ────────────────────────────────────────────────────────────────────
app.engine(
  'hbs',
  engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts'),
    partialsDir: path.join(__dirname, 'views/partials'),
    helpers
  })
);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ── Segurança de transporte ──────────────────────────────────────────────────
// Atrás do proxy da Vercel, req.protocol/req.ip só ficam corretos com isto.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Os templates usam atributos style= em vários pontos; manter inline
        // aqui é bem menos arriscado do que liberar script inline.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isProd ? [] : null
      }
    },
    // Fotos e documentos são servidos pelo próprio app, sem embed externo.
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'same-origin' },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false
  })
);

// ── Parsers ──────────────────────────────────────────────────────────────────
// Limite explícito: sem isso um POST gigante consome memória à toa.
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: isProd ? '7d' : 0,
    etag: true
  })
);

// ── Rate limiting ────────────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: 'Muitas requisições. Aguarde alguns minutos.'
  })
);

// ── Sessão ───────────────────────────────────────────────────────────────────
const SESSION_TTL = 1000 * 60 * 60 * 8;
const sessionSecret = process.env.SESSION_SECRET;

if (isProd && !sessionSecret) {
  // Segredo fixo em produção = qualquer pessoa forja um cookie de sessão e
  // entra como veterinário. Melhor não subir do que subir assim.
  throw new Error('SESSION_SECRET é obrigatório em produção. Configure nas env vars da Vercel.');
}

app.use(
  session({
    name: 'ficha.sid',
    secret: sessionSecret || 'dev-only-secret-nao-use-em-producao',
    store: new DbSessionStore({ ttlMs: SESSION_TTL }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: SESSION_TTL
    }
  })
);

// ── Schema ───────────────────────────────────────────────────────────────────
// Em serverless não existe "boot" separado: garantimos o schema no primeiro
// request de cada instância (ensureSchema memoiza a promise).
app.use(async (req, res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (err) {
    next(err);
  }
});

// ── Contexto das views + CSRF ────────────────────────────────────────────────
app.use(csrfToken);
app.use((req, res, next) => {
  const user = req.session.user || null;
  res.locals.currentUser = user;
  res.locals.isVet = Boolean(user && (user.type === 'veterinario' || user.type === 'admin'));
  res.locals.isRoot = Boolean(user && user.type === 'admin');
  res.locals.currentPath = req.path;
  // Mensagens simples via querystring (?erro=chip). Evita precisar de uma
  // dependência de flash messages só para isto.
  res.locals.erro = typeof req.query.erro === 'string' ? req.query.erro.slice(0, 40) : null;
  res.locals.ok = typeof req.query.ok === 'string' ? req.query.ok.slice(0, 120) : null;
  next();
});
app.use(checkCsrf);

// ── Rotas ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/vet', vetRoutes);
app.use('/media', mediaRoutes);

app.get('/', (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/auth/login');
  return res.redirect(user.type === 'visualizador' ? '/user/dashboard' : '/vet/dashboard');
});

app.get('/health', (req, res) => res.json({ ok: true, storage: require('./database').isRemote ? 'turso' : 'local' }));

// ── Erros ────────────────────────────────────────────────────────────────────
app.use(uploadErrorHandler);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Página não encontrada',
    code: 404,
    message: 'O endereço acessado não existe.',
    backUrl: '/'
  });
});

app.use((err, req, res, next) => {
  console.error('[erro]', err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Erro interno',
    code: 500,
    // Detalhe de erro só em dev: em produção vira vazamento de informação.
    message: isProd ? 'Algo deu errado. Tente novamente.' : String(err.message || err),
    backUrl: '/'
  });
});

module.exports = app;
