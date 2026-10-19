import { app } from './app.js';
import { env } from './config/env.js';

const servidor = app.listen(env.port, () => {
  console.log(`SQL Lab API em http://localhost:${env.port}`);
  console.log(`Origem liberada: ${env.allowedOrigin}`);
});

servidor.on('error', (erro) => {
  console.error('Não foi possível iniciar a API:', erro.message);
  process.exit(1);
});
