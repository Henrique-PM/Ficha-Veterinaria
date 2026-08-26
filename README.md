# 🐾 Ficha Veterinária

Sistema de gestão de fichas veterinárias para abrigos, gatis e canis.

---

## 🚀 Subir na Vercel — passo a passo

### 1. Criar o banco no Turso

O SQLite em arquivo **não funciona na Vercel**: serverless tem disco somente-leitura
e efêmero. O Turso é SQLite gerenciado, com o mesmo dialeto SQL.

```bash
# instalar a CLI
curl -sSfL https://get.tur.so/install.sh | bash

turso auth signup          # cria conta (grátis)
turso db create fichavet   # cria o banco

turso db show fichavet --url          # → TURSO_DATABASE_URL
turso db tokens create fichavet       # → TURSO_AUTH_TOKEN
```

> Dá para fazer tudo pelo site [turso.tech](https://turso.tech) sem CLI.

### 2. Gerar o segredo da sessão

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Configurar as variáveis na Vercel

**Settings → Environment Variables** (marque *Production*, *Preview* e *Development*):

| Variável | Valor | Obrigatória |
|---|---|---|
| `SESSION_SECRET` | o hex gerado no passo 2 | **sim** |
| `TURSO_DATABASE_URL` | `libsql://fichavet-....turso.io` | **sim** |
| `TURSO_AUTH_TOKEN` | o token do passo 1 | **sim** |
| `ROOT_EMAIL` | e-mail do administrador | **sim** |
| `ROOT_PASSWORD` | senha forte do administrador | **sim** |
| `ROOT_NAME` | nome exibido do admin | não |
| `NODE_ENV` | `production` | **sim** |

> ⚠️ Sem `SESSION_SECRET` o app **se recusa a subir** em produção — de propósito.
> Um segredo fixo no código permitiria forjar cookie de sessão e entrar como veterinário.

### 4. Deploy

```bash
git add -A
git commit -m "v2: RBAC, ambientes, segurança e Turso"
git push
```

Importe o repositório na Vercel. O `vercel.json` já está configurado — não mexa nas
configurações de build.

### 5. Primeiro acesso

Entre com `ROOT_EMAIL` / `ROOT_PASSWORD`, vá em **Equipe** e promova os veterinários.
Depois **troque a senha do root** em *Senha*, na barra lateral.

---

## 💻 Rodar localmente

```bash
npm install
cp .env.example .env     # preencha SESSION_SECRET, ROOT_EMAIL, ROOT_PASSWORD
npm run dev              # http://localhost:5001
```

Sem `TURSO_DATABASE_URL`, o banco vira um arquivo em `./data/local.db`.

```bash
npm run seed    # dados de exemplo (gatis, animais, vacinas)
npm run check   # teste de fumaça: 69 verificações de rota, papel e vazamento
```

---

## 🔐 Papéis de acesso

| | Visualizador | Veterinário | Administrador (root) |
|---|:---:|:---:|:---:|
| Ver apresentação dos animais | ✅ | ✅ | ✅ |
| Enviar fotos para a galeria | ✅ | ✅ | ✅ |
| **Prontuário, vacinas, exames, internações** | ❌ | ✅ | ✅ |
| **Peso, alergias, observações clínicas** | ❌ | ✅ | ✅ |
| **FIV/FeLV, chip, dados do tutor** | ❌ | ✅ | ✅ |
| **Documentos e laudos** | ❌ | ✅ | ✅ |
| Gerenciar ambientes e medicamentos | ❌ | ✅ | ✅ |
| Ver a aba **Administração / Equipe** | ❌ | ❌ | ✅ |
| Promover / rebaixar veterinário | ❌ | ❌ | ✅ |
| Conceder papel de administrador | ❌ | ❌ | ✅ |
| Ativar/desativar conta, redefinir senha | ❌ | ❌ | ✅ |

**Todo cadastro público nasce como visualizador.** O papel nunca vem do formulário:
virar veterinário só acontece por promoção em `/vet/equipe`, e essa tela é
**exclusiva do administrador (root)** — o veterinário não vê o menu nem passa pela
rota. Ao rebaixar ou desativar alguém, as sessões dessa pessoa são encerradas na hora.

---

## 🏠 Ambientes (gatis / canis)

Cada animal pode ser alocado a um ambiente — *Gatil 1*, *Canil A*, *Quarentena*…
com tipo, capacidade, cor e observações. A tela mostra ocupação por ambiente e
avisa quando passa da capacidade. Excluir um ambiente **não apaga animal nenhum**:
eles apenas ficam sem alocação.

---

## 📋 O que a ficha registra

**Identificação** — nome, espécie, raça, nascimento (a idade se atualiza sozinha),
sexo, porte, chip, foto, ambiente, status.

**Sanitário** — castração com data, FIV, FeLV, data do teste retroviral.

**Clínico** — histórico de peso e condição corporal, alergias, observações,
vacinas com controle de próxima dose, vermifugação e antiparasitários,
exames e procedimentos, internações **com alta**, prescrições, documentos.

**Desfecho** — adoção com adotante e data, óbito com data e causa.

---

## 🗂️ Estrutura

```
app.js              app Express (exporta, não escuta)
server.js           execução local
api/index.js        entrada da Vercel
database.js         cliente libSQL (Turso remoto ou arquivo local)
db/schema.js        migrations idempotentes, rodam a cada boot
lib/                helpers do Handlebars, store de sessão, bootstrap do root
middleware/         auth, CSRF, uploads
routes/             auth, user, veterinario, equipe, media
views/              layouts, partials e telas
scripts/            check (testes), seed (dados de exemplo)
```

---

## 🛡️ Segurança

- Tema claro fixo, contraste de texto acima de 4.5:1
- Sessões no banco (funcionam em serverless), cookie `HttpOnly` + `SameSite` + `Secure`
- CSRF em todo POST, com token por sessão e comparação em tempo constante
- CSP sem `script-src: unsafe-inline` — nenhum JS inline nos templates
- Rate limit global e específico nas rotas de credencial
- Papel definido no servidor; sessões encerradas ao mudar
- Uploads com limite de tamanho e whitelist de tipo; download sempre como `attachment`
- Fotos e documentos exigem login; documento exige papel de veterinário
- Consultas parametrizadas em toda parte; a área do visualizador só carrega colunas públicas
- `0 vulnerabilidades` no `npm audit`
