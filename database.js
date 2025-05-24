const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err.message);
  } else {
    console.log('Conectado ao banco SQLite.');
  }
});

// Inicialização do banco de dados
db.serialize(() => {
  // Tabela de usuários
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    type TEXT CHECK(type IN ('veterinario', 'visualizador')) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1
  )`);

  // Tabela de animais
  db.run(`CREATE TABLE IF NOT EXISTS animals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    species TEXT NOT NULL,
    breed TEXT,
    age INTEGER,
    sex TEXT CHECK(sex IN ('macho', 'fêmea', 'indeterminado')),
    photo TEXT,
    entry_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('abrigo', 'hospital', 'clinica', 'adotado', 'falecido')),
    description TEXT,
    characteristics TEXT
  )`);

  // Tabela de fichas veterinárias
  db.run(`CREATE TABLE IF NOT EXISTS health_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    weight REAL,
    body_condition TEXT,
    observations TEXT,
    allergies TEXT,
    FOREIGN KEY (animal_id) REFERENCES animals(id)
  )`);

  // Tabela de vacinas
  db.run(`CREATE TABLE IF NOT EXISTS vaccines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    application_date DATETIME NOT NULL,
    next_dose DATETIME,
    batch TEXT,
    veterinarian_id INTEGER NOT NULL,
    observations TEXT,
    FOREIGN KEY (animal_id) REFERENCES animals(id),
    FOREIGN KEY (veterinarian_id) REFERENCES users(id)
  )`);

  // Tabela de internações
  db.run(`CREATE TABLE IF NOT EXISTS hospitalizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    entry_date DATETIME NOT NULL,
    exit_date DATETIME,
    reason TEXT NOT NULL,
    diagnosis TEXT,
    treatment TEXT,
    procedures TEXT,
    observations TEXT,
    exit_status TEXT,
    FOREIGN KEY (animal_id) REFERENCES animals(id)
  )`);
});

module.exports = db;
