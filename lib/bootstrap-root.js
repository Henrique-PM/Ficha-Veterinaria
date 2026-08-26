const bcrypt = require('bcryptjs');
const db = require('../database');

/*
 * Cria a conta root (papel `admin`) a partir de ROOT_EMAIL / ROOT_PASSWORD.
 *
 * Existe porque alguém precisa ser o primeiro veterinário: sem isso o sistema
 * sobe com todo mundo como visualizador e ninguém consegue promover ninguém.
 * O root é quem promove os primeiros veterinários; a partir daí a própria
 * equipe se administra em /vet/equipe.
 *
 * Roda uma vez por instância e é idempotente: se a conta já existe, só garante
 * que ela continua admin e ativa. A senha NUNCA é sobrescrita depois da
 * criação — trocar a senha pelo painel não é desfeito no próximo deploy.
 */
async function bootstrapRoot() {
  const email = String(process.env.ROOT_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ROOT_PASSWORD || '');

  if (!email || !password) {
    const { total } = await db.get("SELECT COUNT(*) AS total FROM users WHERE type = 'admin'");
    if (Number(total) === 0) {
      console.warn(
        '[bootstrap] Nenhuma conta root e ROOT_EMAIL/ROOT_PASSWORD não configurados. ' +
          'Ninguém conseguirá promover veterinários. Configure as variáveis e faça um novo deploy.'
      );
    }
    return null;
  }

  const existing = await db.get('SELECT id, type, active FROM users WHERE email = ?', [email]);

  if (existing) {
    if (existing.type !== 'admin' || !existing.active) {
      await db.run("UPDATE users SET type = 'admin', active = 1 WHERE id = ?", [existing.id]);
      console.log(`[bootstrap] Conta root restaurada: ${email}`);
    }
    return existing.id;
  }

  const hash = await bcrypt.hash(password, 10);
  const { lastID } = await db.run(
    "INSERT INTO users (name, email, password, type, active) VALUES (?, ?, ?, 'admin', 1)",
    [String(process.env.ROOT_NAME || 'Administrador').slice(0, 120), email, hash]
  );

  console.log(`[bootstrap] Conta root criada: ${email}`);
  return lastID;
}

module.exports = bootstrapRoot;
