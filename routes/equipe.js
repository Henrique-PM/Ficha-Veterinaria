const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../database');
const { ensureVet } = require('../middleware/auth');
const { killSessionsForUser } = require('../lib/session-store');

const router = express.Router();

/*
 * Gestão de acesso.
 *
 * Regras:
 *  - todo cadastro nasce visualizador (ver routes/auth.js);
 *  - veterinário promove visualizador → veterinário, e rebaixa veterinário;
 *  - admin (root) faz tudo, inclusive criar outro admin, desativar contas e
 *    redefinir senha;
 *  - ninguém mexe no próprio papel, e admin só é tocado por admin.
 */

const ROLES = ['visualizador', 'veterinario', 'admin'];

const isAdmin = (user) => user.type === 'admin';

function deny(res, message, back = '/vet/equipe') {
  return res.status(403).render('error', {
    title: 'Ação não permitida',
    code: 403,
    message,
    backUrl: back
  });
}

async function logChange(targetId, actorId, from, to, action) {
  await db.run(
    'INSERT INTO role_changes (target_user_id, actor_user_id, from_type, to_type, action) VALUES (?,?,?,?,?)',
    [targetId, actorId, from, to, action]
  );
}

router.use(ensureVet);

// ── Listagem ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim();
    const params = [];
    let where = '';
    if (search) {
      where = 'WHERE name LIKE ? OR email LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    const users = await db.all(
      `SELECT id, name, email, type, active, created_at FROM users
       ${where}
       ORDER BY CASE type WHEN 'admin' THEN 0 WHEN 'veterinario' THEN 1 ELSE 2 END, name`,
      params
    );

    const history = await db.all(`
      SELECT rc.*, t.name AS target_name, a.name AS actor_name
      FROM role_changes rc
      JOIN users t ON t.id = rc.target_user_id
      JOIN users a ON a.id = rc.actor_user_id
      ORDER BY rc.created_at DESC LIMIT 15
    `);

    res.render('vet/equipe', {
      title: 'Equipe',
      users,
      history,
      search,
      viewerIsAdmin: isAdmin(req.session.user),
      totals: {
        admins: users.filter((u) => u.type === 'admin' && u.active).length,
        vets: users.filter((u) => u.type === 'veterinario' && u.active).length,
        viewers: users.filter((u) => u.type === 'visualizador' && u.active).length
      },
      aviso: req.query.ok || null
    });
  } catch (err) {
    next(err);
  }
});

// ── Mudança de papel ─────────────────────────────────────────────────────────
router.post('/:id/papel', async (req, res, next) => {
  try {
    const actor = req.session.user;
    const targetId = Number(req.params.id);
    const novoPapel = String(req.body.type || '');

    if (!ROLES.includes(novoPapel)) return deny(res, 'Papel inválido.');

    // Mudar o próprio papel permitiria o único admin se rebaixar por engano e
    // trancar todo mundo para fora da administração.
    if (targetId === actor.id) {
      return deny(res, 'Você não pode alterar o seu próprio papel. Peça a outra pessoa da equipe.');
    }

    const target = await db.get('SELECT id, name, type, active FROM users WHERE id = ?', [targetId]);
    if (!target) return deny(res, 'Usuário não encontrado.');

    // Só admin mexe em admin — nos dois sentidos: promover alguém a admin e
    // rebaixar quem já é. Senão qualquer veterinário rebaixaria o root.
    if ((target.type === 'admin' || novoPapel === 'admin') && !isAdmin(actor)) {
      return deny(res, 'Apenas o administrador pode conceder ou remover o papel de administrador.');
    }

    if (target.type === novoPapel) return res.redirect('/vet/equipe');

    // Não deixa a última conta de administrador ativa deixar de ser admin.
    if (target.type === 'admin' && novoPapel !== 'admin') {
      const { total } = await db.get("SELECT COUNT(*) AS total FROM users WHERE type = 'admin' AND active = 1");
      if (Number(total) <= 1) return deny(res, 'Este é o único administrador ativo. Promova outro antes de rebaixá-lo.');
    }

    await db.run('UPDATE users SET type = ? WHERE id = ?', [novoPapel, targetId]);
    await logChange(targetId, actor.id, target.type, novoPapel, 'papel');

    // O papel fica gravado dentro da sessão: sem derrubar as sessões, quem foi
    // rebaixado continuaria como veterinário até o cookie vencer.
    await killSessionsForUser(targetId);

    res.redirect(`/vet/equipe?ok=${encodeURIComponent(`${target.name} agora é ${novoPapel}.`)}`);
  } catch (err) {
    next(err);
  }
});

// ── Ativar / desativar (somente admin) ───────────────────────────────────────
router.post('/:id/ativo', async (req, res, next) => {
  try {
    const actor = req.session.user;
    if (!isAdmin(actor)) return deny(res, 'Apenas o administrador pode ativar ou desativar contas.');

    const targetId = Number(req.params.id);
    if (targetId === actor.id) return deny(res, 'Você não pode desativar a própria conta.');

    const target = await db.get('SELECT id, name, type, active FROM users WHERE id = ?', [targetId]);
    if (!target) return deny(res, 'Usuário não encontrado.');

    const ativar = String(req.body.active) === '1';

    if (!ativar && target.type === 'admin') {
      const { total } = await db.get("SELECT COUNT(*) AS total FROM users WHERE type = 'admin' AND active = 1");
      if (Number(total) <= 1) return deny(res, 'Este é o único administrador ativo.');
    }

    await db.run('UPDATE users SET active = ? WHERE id = ?', [ativar ? 1 : 0, targetId]);
    await logChange(targetId, actor.id, target.type, target.type, ativar ? 'reativado' : 'desativado');
    if (!ativar) await killSessionsForUser(targetId);

    res.redirect(`/vet/equipe?ok=${encodeURIComponent(`${target.name} foi ${ativar ? 'reativado' : 'desativado'}.`)}`);
  } catch (err) {
    next(err);
  }
});

// ── Redefinir senha de terceiro (somente admin) ──────────────────────────────
router.post('/:id/senha', async (req, res, next) => {
  try {
    const actor = req.session.user;
    if (!isAdmin(actor)) return deny(res, 'Apenas o administrador pode redefinir a senha de outra pessoa.');

    const password = String(req.body.password || '');
    if (password.length < 8) return deny(res, 'A nova senha precisa ter ao menos 8 caracteres.');

    const target = await db.get('SELECT id, name, type FROM users WHERE id = ?', [req.params.id]);
    if (!target) return deny(res, 'Usuário não encontrado.');

    await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(password, 10), target.id]);
    await logChange(target.id, actor.id, target.type, target.type, 'senha redefinida');
    // Trocar a senha tem que expulsar quem já estava logado com a antiga.
    await killSessionsForUser(target.id);

    res.redirect(`/vet/equipe?ok=${encodeURIComponent(`Senha de ${target.name} redefinida.`)}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
