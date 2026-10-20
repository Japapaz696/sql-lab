import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A porta da API pode ser mudada sem mexer neste arquivo: `API_PORT=4610 npm run dev`.
const apiPort = process.env.API_PORT ?? '3000';
const api = `http://localhost:${apiPort}`;

/**
 * Caminho base da interface.
 *
 * O padrão é relativo (`./`), e isso resolve o principal incômodo de publicar
 * um site estático num subcaminho: no GitHub Pages, um repositório de usuário
 * é servido em `https://<usuario>.github.io/<repositorio>/`, e um caminho
 * absoluto como `/assets/...` apontaria para a raiz errada.
 *
 * Com caminho relativo, os arquivos são resolvidos a partir da página — e o
 * mesmo build serve tanto a raiz quanto um subcaminho.
 */
const base = process.env.VITE_BASE_PATH ?? './';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: {
      '/api': api,
      '/health': api,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
