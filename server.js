// Entrada para rodar local (`npm run dev`). Na Vercel quem entra é api/index.js.
require('./lib/env')();

const app = require('./app');

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`\n  🐾 Ficha Veterinária rodando em http://localhost:${PORT}\n`);
});
