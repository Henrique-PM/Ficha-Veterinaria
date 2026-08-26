const fs = require('fs');
const path = require('path');

/*
 * Carregador mínimo de .env para desenvolvimento local.
 *
 * Não vale a pena uma dependência para isto: na Vercel as variáveis já chegam
 * prontas em process.env, então esta função só faz algo na sua máquina.
 */
function loadEnv(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Variável já definida no shell tem prioridade sobre o arquivo.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

module.exports = loadEnv;
