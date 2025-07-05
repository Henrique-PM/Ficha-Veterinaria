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

app.use(session({
  secret: 'seu_segredo_aqui',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Defina como true se estiver usando HTTPS
}));

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

// Middleware de erro
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Algo deu errado!');
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});