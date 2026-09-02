const multer = require('multer');
const path = require('path');

/*
 * Uploads ficam em memória e vão para o banco como BLOB.
 *
 * Antes não havia limite nenhum: dava para subir um arquivo de qualquer tamanho
 * e de qualquer tipo (inclusive .html/.svg, que viram XSS se servidos inline).
 */

/*
 * 4 MB, não mais: a Vercel corta em 4,5 MB o corpo de request e de response
 * de função. Acima disso o upload morre na plataforma, antes de chegar aqui,
 * e o usuário vê um erro cru em vez do render abaixo. Fotos ainda maiores são
 * reduzidas no navegador antes do envio (public/js/app.js).
 */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_DOC_BYTES = 4 * 1024 * 1024;

const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const ALLOWED_DOC = new Set([
  ...ALLOWED_IMAGE,
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const storage = multer.memoryStorage();

function typeFilter(allowed) {
  return (req, file, cb) => {
    if (allowed.has(file.mimetype)) return cb(null, true);
    const err = new Error('TIPO_NAO_PERMITIDO');
    err.code = 'TIPO_NAO_PERMITIDO';
    return cb(err);
  };
}

const uploadPhoto = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: typeFilter(ALLOWED_IMAGE)
});

const uploadDocument = multer({
  storage,
  limits: { fileSize: MAX_DOC_BYTES, files: 1 },
  fileFilter: typeFilter(ALLOWED_DOC)
});

// Nome de arquivo vindo do usuário não pode ir cru para o header
// Content-Disposition: quebra de linha ali permite injetar outros headers.
function safeFilename(name) {
  const base = path.basename(String(name || 'arquivo'));
  const cleaned = base.replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
  return cleaned || 'arquivo';
}

/*
 * Caminho de volta seguro para as páginas de erro.
 *
 * Usar `req.get('referer')` direto colocava um endereço controlado por terceiro
 * dentro do botão "Voltar": bastava uma página externa disparar um upload acima
 * do limite para o usuário cair na nossa tela de erro com um link de volta para
 * o site do atacante. Aqui só o caminho interno sobrevive — host externo é
 * descartado.
 */
function safeBackUrl(req) {
  const referer = req.get('referer');
  if (referer) {
    try {
      const host = req.get('host');
      const url = new URL(referer, `${req.protocol}://${host}`);
      if (url.host === host) return url.pathname + url.search;
    } catch {
      /* referer malformado: cai no padrão */
    }
  }
  return '/';
}

// Converte os erros do multer em mensagem legível em vez de estourar 500.
function uploadErrorHandler(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).render('error', {
      title: 'Arquivo grande demais',
      code: 413,
      message: 'O arquivo excede o limite de 4 MB. Se for uma imagem, tente reenviar: ' +
        'ela é reduzida automaticamente. Se for PDF, envie uma versão mais leve.',
      backUrl: safeBackUrl(req)
    });
  }
  if (err.code === 'TIPO_NAO_PERMITIDO') {
    return res.status(415).render('error', {
      title: 'Tipo de arquivo não permitido',
      code: 415,
      message: 'Envie imagens (JPG, PNG, WEBP, GIF) ou documentos (PDF, DOC, XLS, TXT, CSV).',
      backUrl: safeBackUrl(req)
    });
  }
  return next(err);
}

module.exports = {
  uploadPhoto,
  uploadDocument,
  uploadErrorHandler,
  safeFilename,
  ALLOWED_IMAGE
};
