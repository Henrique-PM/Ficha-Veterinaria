/*
 * Teste de fumaça: sobe o app de verdade e percorre os fluxos principais.
 *
 * Confere status HTTP, CSRF, isolamento entre papéis e, principalmente, que
 * nenhum dado clínico aparece na área do visualizador.
 *
 *   npm run check
 */
require('../lib/env')();
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const assert = require('assert');
const app = require('../app');

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  ❌ ${name}\n       ${err.message}`);
  }
}

// Cliente HTTP mínimo com cookie jar, para não depender de libs externas.
function makeClient(base) {
  const jar = new Map();

  return async function request(path, { method = 'GET', form = null, redirect = 'manual' } = {}) {
    const headers = {};
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }

    const res = await fetch(base + path, { method, headers, body, redirect });

    for (const raw of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }

    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
  };
}

const tokenFrom = (html) => {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
};

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`\n🔍 Testando em ${base}\n`);

  const anon = makeClient(base);
  const vet = makeClient(base);
  const viewer = makeClient(base);

  try {
    // ── 1. Acesso anônimo ────────────────────────────────────────────────
    console.log('1) Acesso sem login');
    check('GET / redireciona para o login', async () => {});
    {
      const r = await anon('/');
      assert.strictEqual(r.status, 302, `esperava 302, veio ${r.status}`);
      assert.match(r.location, /\/auth\/login/);
    }
    {
      const r = await anon('/vet/dashboard');
      check('área do vet bloqueada para anônimo', () =>
        assert.strictEqual(r.status, 302, `esperava redirect, veio ${r.status}`)
      );
    }
    {
      const r = await anon('/media/animal/1/photo');
      check('foto NÃO é pública (antes era)', () =>
        assert.ok(r.status === 302 || r.status === 401, `esperava bloqueio, veio ${r.status}`)
      );
    }
    {
      const r = await anon('/media/document/1');
      check('documento NÃO é público', () =>
        assert.ok(r.status === 302 || r.status === 401 || r.status === 403, `veio ${r.status}`)
      );
    }
    {
      const r = await anon('/auth/login');
      check('login responde 200', () => assert.strictEqual(r.status, 200));
      check('helmet aplicou CSP', () => assert.ok(r.headers.get('content-security-policy')));
      check('X-Powered-By removido', () => assert.ok(!r.headers.get('x-powered-by')));
      check('nosniff presente', () =>
        assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff')
      );
    }
    {
      const r = await anon('/auth/login', { method: 'POST', form: { email: 'a@b.c', password: 'x' } });
      check('POST sem token CSRF é rejeitado', () =>
        assert.strictEqual(r.status, 403, `esperava 403, veio ${r.status}`)
      );
    }

    // ── 2. Root ──────────────────────────────────────────────────────────
    console.log('\n2) Login do root');
    let rootLogged = false;
    {
      const page = await vet('/auth/login');
      const r = await vet('/auth/login', {
        method: 'POST',
        form: {
          _csrf: tokenFrom(page.text),
          email: process.env.ROOT_EMAIL,
          password: process.env.ROOT_PASSWORD
        }
      });
      rootLogged = r.status === 302 && /\/vet\/dashboard/.test(r.location || '');
      check('root entra e cai no dashboard do vet', () =>
        assert.ok(rootLogged, `status ${r.status}, location ${r.location}`)
      );
    }

    if (!rootLogged) throw new Error('sem sessão de root, os demais testes não fazem sentido');

    // ── 3. Escalada de privilégio ────────────────────────────────────────
    console.log('\n3) Cadastro público não concede papel');
    {
      const page = await viewer('/auth/register');
      const email = `voluntario${Date.now()}@teste.local`;
      const r = await viewer('/auth/register', {
        method: 'POST',
        form: {
          _csrf: tokenFrom(page.text),
          name: 'Voluntário Teste',
          email,
          password: 'senha-de-teste-123',
          type: 'veterinario', // tentativa explícita de escalar privilégio
          invite_code: 'qualquer'
        }
      });
      check('cadastro forçando type=veterinario cai em /user (visualizador)', () =>
        assert.match(r.location || '', /\/user\/dashboard/, `foi para ${r.location}`)
      );
    }
    {
      const r = await viewer('/vet/dashboard');
      check('visualizador recebe 403 em /vet', () =>
        assert.strictEqual(r.status, 403, `veio ${r.status}`)
      );
    }
    {
      const r = await viewer('/vet/equipe');
      check('visualizador não acessa a Equipe', () => assert.strictEqual(r.status, 403));
    }

    // ── 4. Ambientes (gatil) ─────────────────────────────────────────────
    console.log('\n4) Ambientes / gatil');
    let envId = null;
    {
      const page = await vet('/vet/ambientes');
      check('página de ambientes carrega', () => assert.strictEqual(page.status, 200));

      const r = await vet('/vet/ambientes', {
        method: 'POST',
        form: { _csrf: tokenFrom(page.text), name: 'Gatil 1', kind: 'gatil', capacity: '2' }
      });
      check('criar gatil funciona', () => assert.strictEqual(r.status, 302));

      const after = await vet('/vet/ambientes');
      check('gatil aparece na listagem', () => assert.match(after.text, /Gatil 1/));
      const m = after.text.match(/\/vet\/ambientes\/(\d+)"/);
      envId = m ? m[1] : null;
    }

    // ── 5. Animal + ficha ────────────────────────────────────────────────
    console.log('\n5) Cadastro e ficha do animal');
    let animalId = null;
    {
      const page = await vet('/vet/cadastrar-animal');
      check('formulário de cadastro carrega', () => assert.strictEqual(page.status, 200));

      const fields = {
        _csrf: tokenFrom(page.text),
        name: 'Mingau',
        species: 'gato',
        breed: 'SRD',
        sex: 'macho',
        birth_date: '2024-03-10',
        status: 'abrigo',
        environment_id: envId || '',
        neutered: '1',
        fiv_status: 'negativo',
        felv_status: 'negativo',
        characteristics: 'Cinza com peito branco',
        description: 'Resgatado na rua'
      };
      // Sem arquivo, o multer aceita urlencoded normalmente.
      const r = await vet('/vet/cadastrar-animal', { method: 'POST', form: fields });
      check('cadastro de animal redireciona para a ficha', () =>
        assert.match(r.location || '', /\/vet\/animal\/\d+/, `foi para ${r.location}`)
      );
      animalId = (r.location || '').match(/(\d+)$/)?.[1] || null;
    }

    if (animalId) {
      const ficha = await vet(`/vet/animal/${animalId}`);
      check('ficha do vet abre', () => assert.strictEqual(ficha.status, 200));
      check('ficha mostra as abas clínicas', () => {
        assert.match(ficha.text, /Vermifugação/);
        assert.match(ficha.text, /FeLV/);
        assert.match(ficha.text, /Internações/);
      });
      check('animal ficou associado ao gatil', () => assert.match(ficha.text, /Gatil 1/));

      // Vacina com dose vencida → tem que aparecer nos alertas
      const r = await vet(`/vet/animal/${animalId}/vaccine`, {
        method: 'POST',
        form: {
          _csrf: tokenFrom(ficha.text),
          name: 'V4 felina',
          application_date: '2025-01-10',
          next_dose: '2025-02-10'
        }
      });
      check('registrar vacina funciona', () => assert.strictEqual(r.status, 302));

      const alertas = await vet('/vet/alertas');
      check('vacina vencida aparece nos alertas', () => assert.match(alertas.text, /V4 felina/));

      // Internação e alta
      const f2 = await vet(`/vet/animal/${animalId}`);
      await vet(`/vet/animal/${animalId}/hospitalization`, {
        method: 'POST',
        form: {
          _csrf: tokenFrom(f2.text),
          entry_date: '2026-08-01',
          reason: 'Observação clínica'
        }
      });
      const f3 = await vet(`/vet/animal/${animalId}`);
      check('internação deixa o animal como Hospital', () => assert.match(f3.text, /Internação em aberto/));

      const hospId = f3.text.match(/\/vet\/internacao\/(\d+)\/alta/)?.[1];
      check('botão de alta existe (não existia antes)', () => assert.ok(hospId, 'sem rota de alta na página'));

      if (hospId) {
        const alta = await vet(`/vet/internacao/${hospId}/alta`, {
          method: 'POST',
          form: { _csrf: tokenFrom(f3.text), exit_date: '2026-08-05', exit_status: 'recuperado', animal_status: 'abrigo' }
        });
        check('dar alta funciona', () => assert.strictEqual(alta.status, 302));
        const f4 = await vet(`/vet/animal/${animalId}`);
        check('após a alta não há internação em aberto', () =>
          assert.ok(!/Internação em aberto/.test(f4.text))
        );
      }

      const hist = await vet(`/vet/animal/${animalId}/historico`);
      check('histórico monta a linha do tempo', () => {
        assert.strictEqual(hist.status, 200);
        assert.match(hist.text, /V4 felina/);
      });
    }

    // ── 6. VAZAMENTO DE DADO CLÍNICO (o ponto central) ───────────────────
    console.log('\n6) Isolamento dos dados sensíveis');
    if (animalId) {
      // O vet registra dados clínicos com marcadores únicos
      const f = await vet(`/vet/animal/${animalId}`);
      await vet(`/vet/animal/${animalId}/health-record`, {
        method: 'POST',
        form: {
          _csrf: tokenFrom(f.text),
          weight: '4.2',
          body_condition: 'Ideal',
          allergies: 'MARCADOR_ALERGIA_SECRETA',
          observations: 'MARCADOR_OBSERVACAO_CLINICA'
        }
      });

      const vetFicha = await vet(`/vet/animal/${animalId}`);
      check('vet VÊ os dados clínicos', () => {
        assert.match(vetFicha.text, /MARCADOR_ALERGIA_SECRETA/);
        assert.match(vetFicha.text, /MARCADOR_OBSERVACAO_CLINICA/);
      });

      const userFicha = await viewer(`/user/animal/${animalId}`);
      check('visualizador acessa a ficha pública', () => assert.strictEqual(userFicha.status, 200));
      check('visualizador NÃO vê alergias', () =>
        assert.ok(!/MARCADOR_ALERGIA_SECRETA/.test(userFicha.text), 'VAZOU alergia')
      );
      check('visualizador NÃO vê observações clínicas', () =>
        assert.ok(!/MARCADOR_OBSERVACAO_CLINICA/.test(userFicha.text), 'VAZOU observação')
      );
      check('visualizador NÃO vê peso', () =>
        assert.ok(!/4\.2\s*kg/.test(userFicha.text), 'VAZOU peso')
      );
      check('visualizador NÃO vê condição corporal', () =>
        assert.ok(!/Condição corporal/i.test(userFicha.text), 'VAZOU condição corporal')
      );
      check('visualizador NÃO vê status FIV/FeLV', () =>
        assert.ok(!/FIV|FeLV/.test(userFicha.text), 'VAZOU status retroviral')
      );
      check('visualizador NÃO vê carteira de vacinação', () =>
        assert.ok(!/V4 felina/.test(userFicha.text), 'VAZOU vacina')
      );
      check('visualizador vê a apresentação do animal', () => assert.match(userFicha.text, /Mingau/));
    }

    // ── 7. Equipe ────────────────────────────────────────────────────────
    console.log('\n7) Promoção de veterinário');
    {
      const equipe = await vet('/vet/equipe');
      check('root acessa a Equipe', () => assert.strictEqual(equipe.status, 200));
      check('lista mostra o voluntário como visualizador', () => assert.match(equipe.text, /Volunt/));

      const alvo = equipe.text.match(/\/vet\/equipe\/(\d+)\/papel/)?.[1];
      if (alvo) {
        const r = await vet(`/vet/equipe/${alvo}/papel`, {
          method: 'POST',
          form: { _csrf: tokenFrom(equipe.text), type: 'veterinario' }
        });
        check('promoção a veterinário funciona', () => assert.strictEqual(r.status, 302));

        // A sessão do promovido tem que ter sido derrubada
        const depois = await viewer('/user/dashboard');
        check('sessão do promovido é encerrada (força novo login)', () =>
          assert.ok(depois.status === 302, `esperava redirect ao login, veio ${depois.status}`)
        );
      }
    }
    {
      // O root não pode mexer no próprio papel: a linha dele não traz botão.
      const equipe = await vet('/vet/equipe');
      check('root não tem botões de ação na própria linha', () =>
        assert.match(equipe.text, /<span class="badge badge-primary">você<\/span>/)
      );
    }

    // ── 8. Demais páginas ────────────────────────────────────────────────
    console.log('\n8) Páginas restantes');
    for (const [nome, url] of [
      ['dashboard', '/vet/dashboard'],
      ['animais', '/vet/animais'],
      ['consultas', '/vet/consultas'],
      ['medicamentos', '/vet/medicamentos'],
      ['relatórios', '/vet/relatorios'],
      ['alertas', '/vet/alertas'],
      ['meus registros', '/vet/meus-registros'],
      ['ambientes', '/vet/ambientes'],
      ['alterar senha', '/auth/senha'],
      ['health', '/health']
    ]) {
      const r = await vet(url);
      check(`${nome} responde 200`, () => assert.strictEqual(r.status, 200, `veio ${r.status}`));
    }
    {
      const r = await vet('/rota/que/nao/existe');
      check('404 usa a página de erro', () => assert.strictEqual(r.status, 404));
    }
    {
      const r = await vet('/vet/registro/users/1/excluir', {
        method: 'POST',
        form: { _csrf: 'x' }
      });
      check('tipo de registro inválido não vira SQL', () => assert.ok(r.status === 403 || r.status === 404));
    }
  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(58)}`);
  if (failures.length) {
    console.log(`❌ ${failures.length} falha(s), ${pass} ok\n`);
    failures.forEach((f) => console.log(`   • ${f.name}: ${f.message}`));
    process.exit(1);
  }
  console.log(`✅ Todos os ${pass} testes passaram\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\n💥 Erro fatal no teste:', err);
  process.exit(1);
});
