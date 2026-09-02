const Handlebars = require('handlebars');
const icons = require('./icons');

/*
 * Helpers do Handlebars.
 *
 * Antes as datas apareciam cruas na tela ("2026-01-18 14:32:07"), o status vinha
 * em minúscula sem acento e não havia nada marcando <option> como selecionada —
 * por isso a ficha usava <script> inline para acertar os selects no carregamento.
 */

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  // "2026-01-18 14:32:07" (SQLite) não é ISO válido em todo runtime.
  const normalized = String(value).trim().replace(' ', 'T');
  const parsed = new Date(normalized.length === 10 ? `${normalized}T12:00:00` : normalized);
  return isNaN(parsed) ? null : parsed;
}

const pad = (n) => String(n).padStart(2, '0');

function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${formatDate(d)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Para value de <input type="date">
function dateInput(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(value) {
  const d = toDate(value);
  if (!d) return null;
  return Math.round((d - new Date()) / 86400000);
}

const STATUS = {
  abrigo: { label: 'Abrigo', variant: 'info' },
  hospital: { label: 'Hospital', variant: 'danger' },
  clinica: { label: 'Clínica', variant: 'warning' },
  adotado: { label: 'Adotado', variant: 'success' },
  falecido: { label: 'Falecido', variant: 'muted' }
};

const RETRO = {
  positivo: { label: 'Positivo', variant: 'danger' },
  negativo: { label: 'Negativo', variant: 'success' },
  indeterminado: { label: 'Indeterminado', variant: 'warning' },
  nao_testado: { label: 'Não testado', variant: 'muted' }
};

const KIND = {
  gatil: { label: 'Gatil', icon: 'cat' },
  canil: { label: 'Canil', icon: 'dog' },
  baia: { label: 'Baia', icon: 'home' },
  quarentena: { label: 'Quarentena', icon: 'shieldAlert' },
  outro: { label: 'Ambiente', icon: 'warehouse' }
};

// A espécie é texto livre no cadastro antigo, então normalizamos antes de olhar.
const SPECIES_ICON = {
  gato: 'cat',
  gata: 'cat',
  felino: 'cat',
  cachorro: 'dog',
  cadela: 'dog',
  cao: 'dog',
  canino: 'dog',
  ave: 'bird',
  passaro: 'bird',
  outro: 'paw'
};

// Um <svg> não pode passar pelo escape do Handlebars, senão chega na tela como
// texto com &lt;svg&gt;. SafeString marca a saída como HTML já confiável — ela é
// montada aqui, nunca a partir de dado do usuário.
const svg = (markup) => new Handlebars.SafeString(markup);

function iconOptions(options) {
  const hash = (options && options.hash) || {};
  return { size: hash.size, className: hash.class, title: hash.title };
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

const helpers = {
  formatDate,
  formatDateTime,
  dateInput,

  // Idade: prefere birth_date (que envelhece sozinho) e só cai no campo `age`
  // antigo, que é um número fixo digitado uma vez e nunca mais atualizado.
  displayAge(animal) {
    const birth = toDate(animal && animal.birth_date);
    if (birth) {
      const now = new Date();
      let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
      if (now.getDate() < birth.getDate()) months -= 1;
      if (months < 0) return '—';
      if (months < 1) return 'Recém-nascido';
      if (months < 24) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
      const years = Math.floor(months / 12);
      return `${years} ${years === 1 ? 'ano' : 'anos'}`;
    }
    const age = animal && animal.age;
    if (age === null || age === undefined || age === '') return '—';
    return `${age} ${Number(age) === 1 ? 'ano' : 'anos'}`;
  },

  statusLabel: (s) => (STATUS[s] || { label: s || '—' }).label,
  statusVariant: (s) => (STATUS[s] || { variant: 'muted' }).variant,
  retroLabel: (s) => (RETRO[s] || RETRO.nao_testado).label,
  retroVariant: (s) => (RETRO[s] || RETRO.nao_testado).variant,
  kindLabel: (k) => (KIND[k] || KIND.outro).label,

  // Ícones de interface: {{icon "syringe"}}, {{icon "trash" class="ico" size=16}}
  icon: (name, options) => svg(icons.render(name, iconOptions(options))),
  kindIcon: (k, options) => svg(icons.render((KIND[k] || KIND.outro).icon, iconOptions(options))),
  speciesIcon: (s, options) => svg(icons.render(SPECIES_ICON[normalize(s)] || 'paw', iconOptions(options))),

  // Situação da próxima dose de vacina/vermífugo
  dueVariant(value) {
    const days = daysBetween(value);
    if (days === null) return 'muted';
    if (days < 0) return 'danger';
    if (days <= 30) return 'warning';
    return 'success';
  },
  dueLabel(value) {
    const days = daysBetween(value);
    if (days === null) return 'Sem previsão';
    if (days < 0) return `Vencida há ${Math.abs(days)} d`;
    if (days === 0) return 'Vence hoje';
    return `Em ${days} d`;
  },

  selected: (a, b) => (String(a) === String(b) ? 'selected' : ''),
  checked: (a) => (a ? 'checked' : ''),

  // Marca o item de menu da seção em que o usuário está. Precisa casar
  // /vet/animal/7 com "Animais", por isso compara o começo do caminho.
  navActive(currentPath, href) {
    const path = String(currentPath || '');
    if (path === href) return 'active';
    const section = String(href).replace(/\/$/, '');
    if (section === '/vet/animais' && /^\/vet\/(animais|animal|cadastrar-animal)/.test(path)) return 'active';
    if (section === '/vet/ambientes' && path.startsWith('/vet/ambiente')) return 'active';
    if (section !== '/vet/dashboard' && path.startsWith(`${section}/`)) return 'active';
    return '';
  },

  // O último argumento é o objeto de options do Handlebars, sempre descartado.
  concat: (...args) => args.slice(0, -1).join(''),

  eq: (a, b) => String(a) === String(b),
  gt: (a, b) => Number(a) > Number(b),
  or: (...args) => args.slice(0, -1).some(Boolean),
  and: (...args) => args.slice(0, -1).every(Boolean),
  not: (a) => !a,

  initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  },

  // Texto longo no card da listagem
  truncate(text, len) {
    const str = String(text || '');
    const max = Number(len) || 100;
    return str.length > max ? `${str.slice(0, max).trimEnd()}…` : str;
  },

  percent(part, total) {
    const t = Number(total);
    if (!t) return 0;
    return Math.round((Number(part) / t) * 100);
  }
};

module.exports = helpers;
