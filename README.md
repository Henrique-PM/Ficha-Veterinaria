# Ficha Veterinária - Sistema de Gestão de Animais

Sistema web completo para gerenciar fichas veterinárias de animais em abrigos, clínicas e hospitais veterinários.

## 🎯 Funcionalidades

### Autenticação e Autorização (RBAC)
- ✅ Login seguro com bcrypt
- ✅ Dois papéis: **veterinário** (acesso completo) e **visualizador** (leitura)
- ✅ Sessões seguras com cookies HttpOnly, SameSite e proteção CSRF
- ✅ Rate limiting global (100 req/15min)

### Gestão de Animais
- ✅ Cadastro completo: espécie, raça, idade, sexo, chip, foto
- ✅ Dashboard com métricas: total de animais, em tratamento, adotados, etc.
- ✅ Busca por nome
- ✅ Biblioteca de fotos com filtros
- ✅ Status: abrigo, hospital, clínica, adotado, falecido

### Ficha Veterinária Completa
- ✅ **Saúde**: peso, condição corporal, alergias, observações
- ✅ **Vacinas**: nome, data aplicação, próxima dose, lote
- ✅ **Internações**: data entrada/saída, motivo, diagnóstico, tratamento
- ✅ **Exames/Procedimentos**: raio-X, ultrassom, etc. com descrição
- ✅ **Documentos**: upload/download de arquivos (PDF, imagem, etc.)

### Segurança
- ✅ Helmet (headers de segurança HTTP)
- ✅ CSRF protection com tokens
- ✅ Validação e sanitização com express-validator
- ✅ SQL prepared statements (proteção contra SQL injection)
- ✅ Autenticação por papel em rotas

## 📋 Requisitos

- Node.js 14+
- npm 6+
- SQLite3

## 🚀 Instalação

```bash
# Clonar repositório
git clone https://github.com/seu-usuario/Ficha-Veterinaria.git
cd Ficha-Veterinaria

# Instalar dependências
npm install

# Rodar em desenvolvimento
npm run dev

# Rodar em produção
npm start
```

Servidor rodará em `http://localhost:5001`

## 🔐 Variáveis de Ambiente

Criar arquivo `.env` na raiz:

```bash
PORT=5001
SESSION_SECRET=seu_segredo_forte_aqui
COOKIE_SECURE=0  # Defina como 1 para HTTPS em produção
NODE_ENV=development
```

## 👥 Papéis e Acesso

### Veterinário
- Acesso completo ao sistema
- Criar/editar/visualizar animais
- Registrar saúde, vacinas, procedimentos, internações
- Upload de documentos
- Dashboard com métricas

### Visualizador
- Apenas leitura
- Ver animais e fichas (sem editar)
- Acessar biblioteca de fotos

## 📚 Estrutura do Banco de Dados

### Tabelas principais
- `users` - usuários do sistema
- `animals` - dados básicos dos animais
- `health_records` - ficha de saúde (peso, condição, alergias)
- `vaccines` - vacinação
- `procedures` - exames e procedimentos
- `hospitalizations` - internações
- `animal_documents` - documentos anexados
- `medications` - medicamentos em stock
- `animal_medications` - tratamentos

## 🔌 Endpoints da API

### Autenticação
- `POST /auth/login` - Login
- `POST /auth/register` - Cadastro
- `GET /auth/logout` - Logout

### Veterinário
- `GET /vet/dashboard` - Dashboard com métricas
- `GET /vet/animal/:id` - Ver ficha completa
- `POST /vet/cadastrar-animal` - Cadastrar animal
- `POST /vet/animal/:id/health-record` - Atualizar saúde
- `POST /vet/animal/:id/vaccine` - Registrar vacina
- `POST /vet/animal/:id/procedure` - Registrar exame/procedimento
- `POST /vet/animal/:id/hospitalization` - Registrar internação
- `POST /vet/animal/:id/document` - Upload documento
- `GET /vet/animal/:animalId/document/:docId` - Download documento
- `GET /vet/biblioteca` - Biblioteca de fotos com paginação
- `GET /vet/search?name=...` - Buscar animal

### Usuário (Visualizador)
- `GET /user/dashboard` - Animais disponíveis
- `GET /user/animal/:id` - Ver ficha (leitura)
- `GET /user/biblioteca-fotos` - Biblioteca de fotos

## 🎨 Design

- Interface moderna **dark theme** (tema escuro)
- Responsivo (mobile, tablet, desktop)
- CSS utilities inline (sem dependências adicionais)
- Formulários com validação client-side e server-side
- Tabelas dinâmicas renderizadas do banco

## 🔧 Desenvolvimento

### Stack
- **Backend**: Express.js 5
- **Frontend**: Handlebars templates
- **Banco**: SQLite3
- **Auth**: bcrypt, express-session
- **Segurança**: helmet, csurf, express-rate-limit, express-validator

### Estrutura de arquivos
```
├── app.js                 # App principal
├── database.js            # Inicialização SQLite
├── middleware/
│   └── auth.js           # Middlewares RBAC
├── routes/
│   ├── auth.js           # Login/registro/logout
│   ├── user.js           # Rotas para visualizadores
│   └── veterinario.js    # Rotas para veterinários
├── views/
│   ├── layouts/
│   │   ├── main.hbs
│   │   └── pesquisa_animais.hbs
│   ├── auth/
│   │   ├── login.hbs
│   │   └── register.hbs
│   ├── user/
│   │   ├── dashboard.hbs
│   │   └── ficha.hbs
│   └── vet/
│       ├── animais.hbs
│       ├── cadastra_animal.hbs
│       ├── cadastra_consulta.hbs
│       └── ficha2.hbs    # Nova ficha completa
├── public/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── script.js
└── package.json
```

## ⚠️ Importante

1. **Primeiro acesso**: Execute `npm install` para criar `node_modules` e inicializar o banco de dados.
2. **Senha padrão** (criar na mão para primeiro usuário ou via formulário de registro).
3. **Documentos**: Suporta qualquer tipo de arquivo; recomenda-se validação de tamanho/tipo em produção.
4. **Dados de teste**: A ficha.hbs antiga continha dados mockados; a nova (ficha2.hbs) renderiza dados reais do BD.

## 🐛 Troubleshooting

**Erro "Conectado ao banco SQLite"**: Base de dados inicia vazia, crie usuários via formulário.

**Upload de documento falha**: Verifique tamanho do arquivo e permissões de escrita em database.sqlite.

**CSRF token inválido**: Certifique-se que a sessão do usuário está ativa e os formulários têm `name="_csrf"`.

## 📝 Licença

ISC - Veja LICENSE

## 👨‍💻 Autor

Henrique-PM

---

**Melhorias Recentes:**
- ✨ Redesign da ficha veterinária com layout moderno
- ✨ Implementação completa de exames/procedimentos
- ✨ Sistema de upload/download de documentos
- ✨ Dashboard com métricas em tempo real
- ✨ Validação e sanitização com express-validator
- 🔒 Proteção CSRF, Helmet, rate limiting