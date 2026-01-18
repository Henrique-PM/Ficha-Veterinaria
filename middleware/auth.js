function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/auth/login');
}

function ensureRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/auth/login');
    const userRole = req.session.user.type;
    if (Array.isArray(role) ? role.includes(userRole) : userRole === role) {
      return next();
    }
    return res.status(403).send('Acesso negado');
  };
}

module.exports = { ensureAuthenticated, ensureRole };
