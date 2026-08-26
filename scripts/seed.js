/*
 * Popula o banco com dados de demonstração.
 *
 *   npm run seed
 *
 * Por segurança só roda no banco local. Para semear um banco remoto de teste,
 * passe --force explicitamente.
 */
require('../lib/env')();

const db = require('../database');
const { ensureSchema } = require('../db/schema');

const force = process.argv.includes('--force');

if (db.isRemote && !force) {
  console.error('❌ TURSO_DATABASE_URL está definida (banco remoto). Use --force se for mesmo isso que você quer.');
  process.exit(1);
}

const hoje = new Date();
const dias = (n) => {
  const d = new Date(hoje);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

(async () => {
  await ensureSchema();

  const vet = await db.get("SELECT id FROM users WHERE type IN ('admin','veterinario') ORDER BY id LIMIT 1");
  if (!vet) {
    console.error('❌ Nenhum veterinário/admin no banco. Configure ROOT_EMAIL/ROOT_PASSWORD e suba o app uma vez.');
    process.exit(1);
  }

  const { total } = await db.get('SELECT COUNT(*) AS total FROM animals');
  if (Number(total) > 0 && !force) {
    console.log(`ℹ️  Já existem ${total} animais. Nada a fazer (use --force para semear mesmo assim).`);
    process.exit(0);
  }

  const ambientes = [
    ['Gatil 1', 'gatil', 6, 'Gatos adultos sociáveis', '#2f7a63'],
    ['Gatil 2', 'gatil', 4, 'Filhotes e recém-chegados', '#9a6a10'],
    ['Gatil FIV+', 'gatil', 4, 'Isolamento para gatos FIV positivos', '#b03434'],
    ['Canil A', 'canil', 8, 'Cães de porte médio e grande', '#2c6081'],
    ['Quarentena', 'quarentena', 3, 'Entrada obrigatória por 14 dias', '#7a2f6b']
  ];

  const envIds = [];
  for (const [name, kind, capacity, notes, color] of ambientes) {
    const { lastID } = await db.run(
      'INSERT INTO environments (name, kind, capacity, notes, color, created_by) VALUES (?,?,?,?,?,?)',
      [name, kind, capacity, notes, color, vet.id]
    );
    envIds.push(lastID);
  }

  const animais = [
    ['Mingau', 'gato', 'SRD', '2022-04-12', 'macho', 'medio', 'abrigo', 1, 'negativo', 'negativo', envIds[0], 'Cinza com peito branco', 'Resgatado em um estacionamento. Muito dócil, adora colo.'],
    ['Nina', 'gato', 'Siamês', '2023-09-01', 'fêmea', 'pequeno', 'abrigo', 1, 'negativo', 'negativo', envIds[0], 'Creme com pontas escuras', 'Tímida no começo, depois muito carinhosa.'],
    ['Tigrão', 'gato', 'SRD', '2020-01-20', 'macho', 'grande', 'abrigo', 1, 'positivo', 'negativo', envIds[2], 'Tigrado laranja', 'FIV positivo, saudável. Precisa de lar sem outros gatos ou com FIV+.'],
    ['Amora', 'gato', 'SRD', '2025-02-14', 'fêmea', 'pequeno', 'abrigo', 0, 'nao_testado', 'nao_testado', envIds[1], 'Preta com meias brancas', 'Filhote resgatada com 3 semanas, mamadeira.'],
    ['Bolinha', 'gato', 'SRD', '2024-11-05', 'macho', 'pequeno', 'abrigo', 0, 'nao_testado', 'nao_testado', envIds[4], 'Branco e cinza', 'Chegou esta semana, ainda em quarentena.'],
    ['Thor', 'cachorro', 'Vira-lata', '2021-06-30', 'macho', 'grande', 'abrigo', 1, 'nao_testado', 'nao_testado', envIds[3], 'Caramelo, orelha esquerda dobrada', 'Muito ativo, adora correr. Bom com crianças.'],
    ['Lua', 'cachorro', 'Border Collie', '2023-03-18', 'fêmea', 'medio', 'clinica', 1, 'nao_testado', 'nao_testado', envIds[3], 'Preta e branca', 'Em tratamento de dermatite.'],
    ['Pipoca', 'gato', 'SRD', '2022-08-08', 'fêmea', 'pequeno', 'adotado', 1, 'negativo', 'negativo', null, 'Rajada cinza', 'Adotada em julho, família ótima.']
  ];

  const ids = [];
  for (const a of animais) {
    const { lastID } = await db.run(
      `INSERT INTO animals
        (name, species, breed, birth_date, sex, size, status, neutered, fiv_status, felv_status,
         environment_id, characteristics, description, created_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [...a, vet.id]
    );
    ids.push(lastID);
  }

  // Vacinas — algumas vencidas de propósito, para os alertas mostrarem algo
  const vacinas = [
    [ids[0], 'V4 felina', dias(-380), dias(-15)],
    [ids[0], 'Antirrábica', dias(-370), dias(-5)],
    [ids[1], 'V4 felina', dias(-200), dias(165)],
    [ids[2], 'Antirrábica', dias(-400), dias(-35)],
    [ids[5], 'V10 canina', dias(-190), dias(175)],
    [ids[6], 'Antirrábica', dias(-90), dias(275)]
  ];
  for (const [animal, nome, aplic, prox] of vacinas) {
    await db.run(
      'INSERT INTO vaccines (animal_id, name, application_date, next_dose, batch, veterinarian_id) VALUES (?,?,?,?,?,?)',
      [animal, nome, aplic, prox, `LT-${Math.floor(Math.random() * 9000 + 1000)}`, vet.id]
    );
  }

  for (const [animal, prod, kind, aplic, prox] of [
    [ids[0], 'Vermivet Plus', 'vermifugo', dias(-100), dias(-10)],
    [ids[3], 'Vermivet Filhotes', 'vermifugo', dias(-20), dias(10)],
    [ids[5], 'Bravecto', 'antipulgas', dias(-60), dias(30)]
  ]) {
    await db.run(
      'INSERT INTO dewormings (animal_id, product, kind, application_date, next_application, veterinarian_id) VALUES (?,?,?,?,?,?)',
      [animal, prod, kind, aplic, prox, vet.id]
    );
  }

  for (const [animal, peso, cond, alerg, obs] of [
    [ids[0], 4.6, 'Ideal', 'Nenhuma conhecida', 'Animal saudável, pelagem em bom estado.'],
    [ids[1], 3.2, 'Magro', 'Frango', 'Ganhou 300 g no último mês.'],
    [ids[2], 5.1, 'Ideal', 'Nenhuma conhecida', 'FIV+ estável, sem sinais clínicos.'],
    [ids[6], 14.8, 'Ideal', 'Nenhuma conhecida', 'Dermatite em tratamento, lesões regredindo.']
  ]) {
    await db.run(
      'INSERT INTO health_records (animal_id, weight, body_condition, allergies, observations, created_by) VALUES (?,?,?,?,?,?)',
      [animal, peso, cond, alerg, obs, vet.id]
    );
  }

  // Uma internação encerrada e uma em aberto
  await db.run(
    `INSERT INTO hospitalizations (animal_id, entry_date, exit_date, reason, diagnosis, treatment, exit_status, responsible_vet)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ids[0], dias(-40), dias(-35), 'Ferimento na pata', 'Laceração superficial', 'Limpeza e antibiótico', 'recuperado', vet.id]
  );
  await db.run(
    `INSERT INTO hospitalizations (animal_id, entry_date, reason, diagnosis, treatment, responsible_vet)
     VALUES (?,?,?,?,?,?)`,
    [ids[6], dias(-6), 'Dermatite generalizada', 'Dermatite alérgica', 'Corticoide e banho medicamentoso', vet.id]
  );

  await db.run(
    'INSERT INTO procedures (animal_id, name, procedure_date, description, veterinarian_id) VALUES (?,?,?,?,?)',
    [ids[2], 'Teste rápido FIV/FeLV', dias(-300), 'FIV reagente, FeLV não reagente.', vet.id]
  );
  await db.run(
    'INSERT INTO procedures (animal_id, name, procedure_date, description, veterinarian_id) VALUES (?,?,?,?,?)',
    [ids[6], 'Raspado de pele', dias(-7), 'Negativo para sarna. Sugere causa alérgica.', vet.id]
  );

  const meds = [
    ['Amoxicilina 250mg', 'Antibiótico de amplo espectro', 40, 'comprimidos', 10],
    ['Prednisolona 20mg', 'Corticoide', 4, 'comprimidos', 10],
    ['Vermivet Plus', 'Vermífugo', 25, 'comprimidos', 8],
    ['Soro fisiológico 500ml', 'Fluidoterapia', 3, 'frascos', 6]
  ];
  const medIds = [];
  for (const m of meds) {
    const { lastID } = await db.run(
      'INSERT INTO medications (name, description, stock_quantity, unit, min_stock_level) VALUES (?,?,?,?,?)',
      m
    );
    medIds.push(lastID);
  }

  await db.run(
    `INSERT INTO animal_medications (animal_id, medication_id, dosage, frequency, start_date, end_date, prescribed_by, status)
     VALUES (?,?,?,?,?,?,?,'ativo')`,
    [ids[6], medIds[1], '1/2 comprimido', '24/24h', dias(-6), dias(4), vet.id]
  );

  console.log(`✅ Dados de exemplo criados: ${ambientes.length} ambientes, ${animais.length} animais, ${vacinas.length} vacinas, ${meds.length} medicamentos.`);
  process.exit(0);
})().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
