const session = require('express-session');
const db = require('../database');

/*
 * Store de sessão em banco.
 *
 * O MemoryStore padrão do express-session não funciona em serverless: cada
 * request pode cair numa instância nova, e a sessão (o login) some. Guardando
 * no Turso, a sessão vale para todas as instâncias e sobrevive a redeploy.
 */
class DbSessionStore extends session.Store {
  constructor({ ttlMs = 1000 * 60 * 60 * 8 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.lastPrune = 0;
  }

  expiresAt(sess) {
    const cookieExpires = sess?.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + this.ttlMs;
  }

  // Limpa sessões vencidas no máximo uma vez por hora, para não pagar um
  // DELETE em toda requisição.
  async prune() {
    if (Date.now() - this.lastPrune < 1000 * 60 * 60) return;
    this.lastPrune = Date.now();
    try {
      await db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
    } catch {
      /* limpeza é best-effort: falhar aqui não pode derrubar o request */
    }
  }

  get(sid, cb) {
    db.get('SELECT data, expires FROM sessions WHERE sid = ?', [sid])
      .then((row) => {
        if (!row) return cb(null, null);
        if (Number(row.expires) < Date.now()) {
          return this.destroy(sid, () => cb(null, null));
        }
        let parsed;
        try {
          parsed = JSON.parse(row.data);
        } catch {
          return this.destroy(sid, () => cb(null, null));
        }
        cb(null, parsed);
      })
      .catch((err) => cb(err));
  }

  set(sid, sess, cb) {
    const payload = JSON.stringify(sess);
    // Guardar o dono da sessão permite derrubar todas as sessões de alguém
    // quando o papel dele muda (ver killSessionsForUser).
    const userId = sess && sess.user ? sess.user.id : null;
    db.run(
      `INSERT INTO sessions (sid, expires, data, user_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data,
                                      user_id = excluded.user_id`,
      [sid, this.expiresAt(sess), payload, userId]
    )
      .then(() => {
        this.prune();
        cb(null);
      })
      .catch((err) => cb(err));
  }

  touch(sid, sess, cb) {
    db.run('UPDATE sessions SET expires = ? WHERE sid = ?', [this.expiresAt(sess), sid])
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  destroy(sid, cb) {
    db.run('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => cb(null))
      .catch((err) => cb(err));
  }
}

/*
 * Encerra todas as sessões de um usuário.
 *
 * O papel (veterinario/visualizador) fica gravado dentro da sessão. Sem isto,
 * quem fosse rebaixado continuaria com acesso de veterinário até o cookie
 * vencer — até 8 horas depois.
 */
async function killSessionsForUser(userId) {
  await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

module.exports = DbSessionStore;
module.exports.killSessionsForUser = killSessionsForUser;
