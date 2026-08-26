// Entrada da Vercel. Todo o tráfego cai aqui (ver vercel.json) e é entregue
// ao mesmo app Express usado localmente — sem app.listen(), que em serverless
// não faz sentido.
module.exports = require('../app');
