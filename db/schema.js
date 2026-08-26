const db = require('../database');

/*
 * Migrations idempotentes: rodam a cada boot e não quebram se já foram aplicadas.
 * CREATE TABLE IF NOT EXISTS para tabelas, tryExec para ALTER TABLE ADD COLUMN
 * (SQLite não tem "ADD COLUMN IF NOT EXISTS", então engolimos "duplicate column").
 */

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    type TEXT CHECK(type IN ('veterinario', 'visualizador', 'admin')) NOT NULL,
    photo BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1
  )`,

  // Gatis / canis / baias — o "ambiente" onde o animal está alojado.
  `CREATE TABLE IF NOT EXISTS environments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT CHECK(kind IN ('gatil','canil','baia','quarentena','outro')) NOT NULL DEFAULT 'gatil',
    capacity INTEGER,
    notes TEXT,
    color TEXT,
    active BOOLEAN NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS animals (
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
  )`,

  `CREATE TABLE IF NOT EXISTS health_records (
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
  )`,

  `CREATE TABLE IF NOT EXISTS vaccines (
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
  )`,

  // Vermifugação / antipulgas / antiparasitário — controle obrigatório em gatil.
  `CREATE TABLE IF NOT EXISTS dewormings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    product TEXT NOT NULL,
    kind TEXT CHECK(kind IN ('vermifugo','antipulgas','carrapaticida','outro')) NOT NULL DEFAULT 'vermifugo',
    application_date DATETIME NOT NULL,
    next_application DATETIME,
    dosage TEXT,
    veterinarian_id INTEGER NOT NULL,
    observations TEXT,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (veterinarian_id) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    stock_quantity INTEGER DEFAULT 0,
    unit TEXT,
    min_stock_level INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS animal_medications (
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
  )`,

  `CREATE TABLE IF NOT EXISTS procedures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    procedure_date DATETIME NOT NULL,
    description TEXT,
    veterinarian_id INTEGER NOT NULL,
    observations TEXT,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (veterinarian_id) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS hospitalizations (
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
  )`,

  `CREATE TABLE IF NOT EXISTS animal_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    photo BLOB NOT NULL,
    mimetype TEXT,
    description TEXT,
    uploaded_by INTEGER NOT NULL,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS animal_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    data BLOB NOT NULL,
    description TEXT,
    uploaded_by INTEGER NOT NULL,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  )`,

  // Sessões no banco: em serverless cada request cai numa instância diferente,
  // então guardar sessão em memória derruba o login a cada clique.
  `CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    data TEXT NOT NULL,
    user_id INTEGER
  )`,

  // Quem promoveu/rebaixou quem. Sem isto, mudança de papel é invisível.
  `CREATE TABLE IF NOT EXISTS role_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    from_type TEXT,
    to_type TEXT,
    action TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (target_user_id) REFERENCES users(id),
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
  )`
];

// Colunas adicionadas depois da v1. Cada uma é opcional e tem default seguro.
const COLUMNS = [
  // Alojamento
  `ALTER TABLE animals ADD COLUMN environment_id INTEGER REFERENCES environments(id)`,
  // Data de nascimento: idade fixa em INTEGER desatualiza sozinha com o tempo.
  `ALTER TABLE animals ADD COLUMN birth_date DATE`,
  // Castração — controle central em gatil/abrigo
  `ALTER TABLE animals ADD COLUMN neutered INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE animals ADD COLUMN neutered_date DATE`,
  // Testes retrovirais: definem isolamento do gato, não podem faltar num gatil
  `ALTER TABLE animals ADD COLUMN fiv_status TEXT DEFAULT 'nao_testado'`,
  `ALTER TABLE animals ADD COLUMN felv_status TEXT DEFAULT 'nao_testado'`,
  `ALTER TABLE animals ADD COLUMN retro_test_date DATE`,
  // Adotante / responsável
  `ALTER TABLE animals ADD COLUMN tutor_name TEXT`,
  `ALTER TABLE animals ADD COLUMN tutor_contact TEXT`,
  `ALTER TABLE animals ADD COLUMN adoption_date DATE`,
  // Óbito
  `ALTER TABLE animals ADD COLUMN deceased_date DATE`,
  `ALTER TABLE animals ADD COLUMN deceased_cause TEXT`,
  // Porte, usado para triagem e para o catálogo público
  `ALTER TABLE animals ADD COLUMN size TEXT`,
  `ALTER TABLE animals ADD COLUMN updated_at DATETIME`,
  `ALTER TABLE animal_photos ADD COLUMN mimetype TEXT`,
  `ALTER TABLE animals ADD COLUMN photo_mimetype TEXT`,
  // Permite encerrar todas as sessões de alguém que foi rebaixado.
  `ALTER TABLE sessions ADD COLUMN user_id INTEGER`
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_animals_status ON animals(status)`,
  `CREATE INDEX IF NOT EXISTS idx_animals_species ON animals(species)`,
  `CREATE INDEX IF NOT EXISTS idx_animals_env ON animals(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_health_animal ON health_records(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vaccines_animal ON vaccines(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vaccines_next ON vaccines(next_dose)`,
  `CREATE INDEX IF NOT EXISTS idx_deworm_animal ON dewormings(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_proc_animal ON procedures(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_hosp_animal ON hospitalizations(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_hosp_exit ON hospitalizations(exit_date)`,
  `CREATE INDEX IF NOT EXISTS idx_meds_animal ON animal_medications(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_docs_animal ON animal_documents(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_photos_animal ON animal_photos(animal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_type ON users(type)`
];

let migrationPromise = null;

async function runMigrations() {
  for (const sql of TABLES) await db.client.execute(sql);
  for (const sql of COLUMNS) await db.tryExec(sql);
  for (const sql of INDEXES) await db.client.execute(sql);
  await require('../lib/bootstrap-root')();
}

// Em serverless o módulo é reaproveitado entre requests, então guardamos a
// promise: as migrations rodam uma vez por instância, não uma vez por request.
function ensureSchema() {
  if (!migrationPromise) {
    migrationPromise = runMigrations().catch((err) => {
      migrationPromise = null; // permite nova tentativa no próximo request
      throw err;
    });
  }
  return migrationPromise;
}

module.exports = { ensureSchema, runMigrations };
