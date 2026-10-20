import { app } from './app.js';
import { env } from './config/env.js';
import { exigirSeparacaoDePrivilegios } from './services/privilegios.service.js';

/**
 * Inicialização da API.
 *
 * A ordem importa: a separação de privilégios é verificada **antes** de a
 * API aceitar tráfego. Em produção, se o usuário de execução puder escrever,
 * a API não sobe — é preferível ficar fora do ar a rodar com um usuário que
 * altera o banco.
 */
async function iniciar(): Promise<void> {
  await exigirSeparacaoDePrivilegios();

  const servidor = app.listen(env.port, () => {
    console.log(`SQL Lab API em http://localhost:${env.port}`);
    console.log(`Origens liberadas: ${env.allowedOrigins.join(', ')}`);
    console.log(`Ambiente: ${env.isProduction ? 'producao' : 'desenvolvimento'}`);
  });

  servidor.on('error', (erro: NodeJS.ErrnoException) => {
    console.error('Não foi possível iniciar a API:', erro.message);
    process.exit(1);
  });
}

iniciar().catch((erro: unknown) => {
  console.error('Falha na inicialização:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
