import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A porta da API pode ser mudada sem mexer neste arquivo: `API_PORT=4610 npm run dev`.
const apiPort = process.env.API_PORT ?? '3000';
const api = `http://localhost:${apiPort}`;

export default defineConfig({
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
