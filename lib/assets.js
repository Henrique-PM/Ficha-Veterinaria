const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/*
 * Versão dos arquivos estáticos (cache busting).
 *
 * express.static entrega /css/app.css com `max-age=7d` em produção. Como a URL
 * nunca mudava, quem já tinha aberto o site continuava usando o CSS antigo do
 * cache do navegador por até uma semana — recebendo junto o HTML novo, que usa
 * classes que aquele CSS não conhece. A página chegava desmontada: sem a regra
 * `.icon`, cada <svg> inline assume o tamanho padrão de elemento substituído
 * (300×150px) e toma a tela inteira.
 *
 * O carimbo é o hash do próprio conteúdo, não a data do deploy: muda sozinho
 * quando (e só quando) o arquivo muda, e é idêntico em todas as instâncias
 * serverless — duas instâncias nunca servem versões diferentes da mesma URL.
 */
const VERSIONED = ['public/css/app.css', 'public/js/app.js'];

function computeVersion() {
  const hash = crypto.createHash('sha1');

  for (const relative of VERSIONED) {
    try {
      hash.update(fs.readFileSync(path.join(__dirname, '..', relative)));
    } catch {
      // Arquivo ausente não pode derrubar o boot; entra o nome no lugar.
      hash.update(relative);
    }
  }

  return hash.digest('hex').slice(0, 10);
}

module.exports = { assetVersion: computeVersion() };
