const hbs = require('hbs'); 
const express = require('express');
const session = require('express-session');
const { engine } = require('express-handlebars');
const path = require('path');
const db = require('./database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const vetRoutes = require('./routes/veterinario');

const app = express();

// Configurações
app.engine('hbs', engine({ extname: '.hbs', defaultLayout: 'main' }));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sessão
app.set('trust proxy', 1);

app.use(session({
  name: 'ficha.sid',
  secret: process.env.SESSION_SECRET || 'change_this_dev_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

// Locals úteis para as views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Rotas
app.use('/auth', authRoutes);
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
  console.error(err.stack);
  res.status(500).send('Algo deu errado!');
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});