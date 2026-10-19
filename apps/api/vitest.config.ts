import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizDoPacote = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Fixa a raiz no pacote: sem isso, o Vitest sobe até a raiz do monorepo e
  // o padrão de inclusão não encontra os arquivos.
  root: raizDoPacote,
  test: {
    environment: 'node',
    dir: 'src',
    include: ['**/*.test.ts'],
    // Roda antes de qualquer import do módulo de teste, para que a
    // aplicação aponte para o banco de teste.
    setupFiles: ['./src/tests/setup.ts'],
    // Prepara o banco uma vez, no processo principal.
    globalSetup: ['./src/tests/global-setup.ts'],
    // Os testes de integração compartilham o mesmo banco: rodam em série.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
