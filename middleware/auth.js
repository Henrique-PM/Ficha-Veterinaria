function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/auth/login');
}

function ensureRole(role) {
  const allowed = Array.isArray(role) ? role : [role];
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/auth/login');
    if (allowed.includes(req.session.user.type)) return next();

    // Sem permissão: manda para a área do próprio papel em vez de dar 403 seco,
    // que é o que acontecia quando um visualizador tocava numa URL /vet.
    return res.status(403).render('error', {
      title: 'Acesso negado',
      code: 403,
      message: 'Esta área é exclusiva da equipe veterinária.',
      backUrl: req.session.user.type === 'veterinario' ? '/vet/dashboard' : '/user/dashboard'
    });
  };
}

const ensureVet = ensureRole(['veterinario', 'admin']);

// Administração da equipe. Veterinário NÃO entra aqui: conceder acesso é
// atribuição exclusiva do root.
function ensureAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/auth/login');
  if (req.session.user.type === 'admin') return next();

  return res.status(403).render('error', {
    title: 'Acesso restrito',
    code: 403,
    message: 'A administração da equipe é exclusiva do administrador do sistema.',
    backUrl: req.session.user.type === 'visualizador' ? '/user/dashboard' : '/vet/dashboard'
  });
}

module.exports = { ensureAuthenticated, ensureRole, ensureVet, ensureAdmin };
