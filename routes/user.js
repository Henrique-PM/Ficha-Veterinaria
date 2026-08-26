const express = require('express');

const db = require('../database');
const { ensureRole } = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/uploads');
const { verifyCsrf } = require('../middleware/csrf');

const router = express.Router();

/*
 * Área do visualizador (voluntário / adotante).
 *
 * REGRA DESTA ROTA: nada de prontuário aqui.
 *
 * A versão anterior renderizava health_records na ficha do visualizador —
 * condição corporal, alergias e as observações clínicas do veterinário ficavam
 * visíveis para qualquer conta comum. Peso, vacinas, internações, exames,
 * medicamentos, documentos, número do chip e dados do tutor agora existem
 * somente em /vet.
 *
 * A proteção é feita na consulta, não no template: a lista de colunas abaixo é
 * a única coisa que sai do banco por aqui, então nenhum erro de view consegue
 * expor um campo clínico que nunca foi carregado.
 */
const PUBLIC_COLUMNS = `
  a.id, a.name, a.species, a.breed, a.age, a.birth_date, a.sex, a.size,
  a.status, a.entry_date, a.description, a.characteristics, a.neutered,
  a.photo IS NOT NULL AS has_photo,
  e.name AS environment_name, e.kind AS environment_kind
`;

router.use(ensureRole('visualizador'));

// Catálogo de animais
router.get('/dashboard', async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim();
    const species = String(req.query.especie || '').trim();

    const where = ["a.status != 'falecido'"];
    const params = [];

    if (search) {
      where.push('(a.name LIKE ? OR a.breed LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (species) {
      where.push('LOWER(a.species) = LOWER(?)');
      params.push(species);
    }

    const animals = await db.all(
      `SELECT ${PUBLIC_COLUMNS}
       FROM animals a
       LEFT JOIN environments e ON a.environment_id = e.id
       WHERE ${where.join(' AND ')}
       ORDER BY a.entry_date DESC`,
      params
    );

    const especies = await db.all(
      "SELECT DISTINCT species FROM animals WHERE status != 'falecido' ORDER BY species"
    );

    res.render('user/dashboard', {
      title: 'Animais',
      animals,
      especies,
      search,
      species,
      total: animals.length
    });
  } catch (err) {
    next(err);
  }
});

// Ficha reduzida — apresentação do animal, sem nada clínico
router.get('/animal/:id', async (req, res, next) => {
  try {
    const animal = await db.get(
      `SELECT ${PUBLIC_COLUMNS}
       FROM animals a
       LEFT JOIN environments e ON a.environment_id = e.id
       WHERE a.id = ?`,
      [req.params.id]
    );

    if (!animal) {
      return res.status(404).render('error', {
        title: 'Animal não encontrado',
        code: 404,
        message: 'Este animal não existe ou foi removido.',
        backUrl: '/user/dashboard'
      });
    }

    const photos = await db.all(
      'SELECT id, description, upload_date FROM animal_photos WHERE animal_id = ? ORDER BY upload_date DESC',
      [req.params.id]
    );

    res.render('user/ficha', { title: animal.name, animal, photos });
  } catch (err) {
    next(err);
  }
});

// Voluntário pode contribuir com fotos do animal
router.post(
  '/animal/:id/photo',
  uploadPhoto.single('photo'),
  verifyCsrf, // depois do multer: é ele quem preenche req.body em multipart
  async (req, res, next) => {
    try {
      const animalId = req.params.id;

      if (!req.file || !req.file.buffer) {
        return res.status(400).render('error', {
          title: 'Foto obrigatória',
          code: 400,
          message: 'Selecione uma imagem para enviar.',
          backUrl: `/user/animal/${animalId}`
        });
      }

      // Confere que o animal existe antes de gravar; sem isto era possível
      // inserir fotos apontando para ids inexistentes.
      const animal = await db.get('SELECT id FROM animals WHERE id = ?', [animalId]);
      if (!animal) return res.status(404).send('Animal não encontrado');

      await db.run(
        'INSERT INTO animal_photos (animal_id, photo, mimetype, description, uploaded_by) VALUES (?, ?, ?, ?, ?)',
        [
          animalId,
          req.file.buffer,
          req.file.mimetype,
          String(req.body.description || '').slice(0, 200) || null,
          req.session.user.id
        ]
      );

      return res.redirect(`/user/animal/${animalId}`);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
