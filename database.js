const fs = require('fs');
const path = require('path');

/*
 * Camada de acesso ao banco (libSQL / Turso).
 *
 * Local  → arquivo em ./data/local.db
 * Vercel → Turso via HTTP (serverless não tem disco gravável)
 *
 * O dialeto é SQLite nos dois casos, então a mesma query roda nos dois lugares.
 */

const remoteUrl = process.env.TURSO_DATABASE_URL;
const isRemote = Boolean(remoteUrl);

let client;

if (isRemote) {
  // O export /web não carrega binário nativo — é o que funciona em serverless.
  const { createClient } = require('@libsql/client/web');
  client = createClient({
    url: remoteUrl,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
} else {
  const { createClient } = require('@libsql/client');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  client = createClient({ url: `file:${path.join(dataDir, 'local.db')}` });
}

// libSQL devolve BLOB como ArrayBuffer; as views e o res.send() querem Buffer.
function normalizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof ArrayBuffer ? Buffer.from(value) : value;
  }
  return out;
}

async function all(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows.map(normalizeRow);
}

async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] || null;
}

async function run(sql, args = []) {
  const result = await client.execute({ sql, args });
  return {
    // lastInsertRowid vem como BigInt — Number é seguro até 2^53 ids.
    lastID: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid),
    changes: result.rowsAffected
  };
}

// Roda várias instruções como uma unidade. Usado nas migrations e em
// operações que precisam ser tudo-ou-nada (ex.: prescrever + baixar estoque).
async function batch(statements) {
  return client.batch(statements, 'write');
}

// Executa um SQL sem parâmetros, ignorando erro de "coluna já existe".
// As migrations rodam a cada boot, então precisam ser idempotentes.
async function tryExec(sql) {
  try {
    await client.execute(sql);
    return true;
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('duplicate column') || msg.includes('already exists')) return false;
    throw err;
  }
}

module.exports = { client, all, get, run, batch, tryExec, isRemote };
