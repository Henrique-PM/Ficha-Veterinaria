const express = require('express');

const db = require('../database');
const { ensureAuthenticated, ensureVet } = require('../middleware/auth');
const { safeFilename, ALLOWED_IMAGE } = require('../middleware/uploads');

const router = express.Router();

/*
 * Fotos e documentos.
 *
 * Antes /animal/photo/:id e /animal/photo-extra/:id ficavam fora de qualquer
 * autenticação, em app.js: bastava percorrer os ids para baixar as fotos de
 * todos os animais sem ter conta. Agora tudo aqui exige login, e documento
 * (laudo, exame, receita) exige papel de veterinário.
 */
router.use(ensureAuthenticated);

// Nunca ecoa o mimetype cru do banco: um "text/html" salvo junto com o arquivo
// faria o navegador executar o conteúdo na nossa origem.
function safeImageType(mimetype) {
  return ALLOWED_IMAGE.has(mimetype) ? mimetype : 'image/jpeg';
}

function sendBinary(res, buffer, contentType) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(buffer);
}

// Foto principal do animal
router.get('/animal/:id/photo', async (req, res, next) => {
  try {
    const row = await db.get('SELECT photo, photo_mimetype FROM animals WHERE id = ?', [req.params.id]);
    if (!row || !row.photo) return res.status(404).send('Imagem não encontrada');
    return sendBinary(res, row.photo, safeImageType(row.photo_mimetype));
  } catch (err) {
    next(err);
  }
});

// Foto da galeria
router.get('/photo/:photoId', async (req, res, next) => {
  try {
    const row = await db.get('SELECT photo, mimetype FROM animal_photos WHERE id = ?', [req.params.photoId]);
    if (!row || !row.photo) return res.status(404).send('Imagem não encontrada');
    return sendBinary(res, row.photo, safeImageType(row.mimetype));
  } catch (err) {
    next(err);
  }
});

// Documento clínico — só equipe veterinária
router.get('/document/:docId', ensureVet, async (req, res, next) => {
  try {
    const row = await db.get(
      'SELECT filename, mimetype, data FROM animal_documents WHERE id = ?',
      [req.params.docId]
    );
    if (!row) return res.status(404).send('Documento não encontrado');

    // O nome do arquivo vem do upload. Sem sanitizar, uma quebra de linha no
    // nome permite injetar cabeçalhos HTTP arbitrários na resposta.
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(row.filename)}"`);
    // Sempre attachment + octet-stream: evita que um PDF/SVG malicioso execute
    // script na origem do app ao ser aberto no navegador.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(row.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
