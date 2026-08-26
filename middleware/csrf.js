const crypto = require('crypto');

/*
 * CSRF por synchronizer token.
 *
 * O pacote `csurf` que estava no package.json está descontinuado desde 2022 e
 * nunca chegou a ser plugado no app — todo POST estava aberto a CSRF. São ~40
 * linhas, então implementamos aqui em vez de arrastar dependência morta.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  // timingSafeEqual exige tamanhos iguais, então comparamos o hash.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(bufA).digest(),
    crypto.createHash('sha256').update(bufB).digest()
  );
}

function submittedToken(req) {
  return (
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    (req.query && req.query._csrf) ||
    ''
  );
}

// Disponibiliza {{csrfToken}} em todas as views.
function csrfToken(req, res, next) {
  res.locals.csrfToken = issueToken(req);
  next();
}

/*
 * Valida o token. Precisa rodar DEPOIS do parser do corpo.
 *
 * Em multipart/form-data quem preenche req.body é o multer, que roda por rota —
 * então esse caso é pulado aqui e verificado explicitamente logo depois do
 * multer, via `verifyCsrf` (ver rotas de upload).
 */
function checkCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if ((req.get('content-type') || '').startsWith('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

function verifyCsrf(req, res, next) {
  const expected = req.session && req.session.csrfToken;
  const provided = submittedToken(req);

  if (!expected || !provided || !safeEqual(expected, provided)) {
    return res.status(403).render('error', {
      layout: 'main',
      title: 'Sessão expirada',
      code: 403,
      message: 'Formulário expirado ou inválido. Volte, recarregue a página e tente de novo.'
    });
  }
  return next();
}

module.exports = { csrfToken, checkCsrf, verifyCsrf };
