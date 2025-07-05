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
    type TEXT CHECK(type IN ('veterinario', 'visualizador', 'admin')) NOT NULL,
    photo BLOB,
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
    photo BLOB,
    chip_number TEXT UNIQUE,
    entry_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('abrigo', 'hospital', 'clinica', 'adotado', 'falecido')),
    description TEXT,
    characteristics TEXT,
    created_by INTEGER NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
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
    created_by INTEGER NOT NULL,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
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
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (veterinarian_id) REFERENCES users(id)
  )`);

  // Tabela de medicamentos
  db.run(`CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    stock_quantity INTEGER DEFAULT 0,
    unit TEXT,
    min_stock_level INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabela de associação animal-medicamento (para tratamento)
  db.run(`CREATE TABLE IF NOT EXISTS animal_medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    medication_id INTEGER NOT NULL,
    dosage TEXT NOT NULL,
    frequency TEXT NOT NULL,
    start_date DATETIME NOT NULL,
    end_date DATETIME,
    prescribed_by INTEGER NOT NULL,
    observations TEXT,
    status TEXT CHECK(status IN ('ativo', 'suspenso', 'concluído')) DEFAULT 'ativo',
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (medication_id) REFERENCES medications(id),
    FOREIGN KEY (prescribed_by) REFERENCES users(id)
  )`);

  // Tabela de procedimentos
  db.run(`CREATE TABLE IF NOT EXISTS procedures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    procedure_date DATETIME NOT NULL,
    description TEXT,
    veterinarian_id INTEGER NOT NULL,
    observations TEXT,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
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
    responsible_vet INTEGER NOT NULL,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (responsible_vet) REFERENCES users(id)
  )`);

  // Tabela de fotos adicionais dos animais
  db.run(`CREATE TABLE IF NOT EXISTS animal_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    photo BLOB NOT NULL,
    description TEXT,
    uploaded_by INTEGER NOT NULL,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  )`);
});

module.exports = db;