import cors from 'cors';
import express, { type Request, type Response } from 'express';

import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { scenariosRouter } from './routes/scenarios.routes.js';

export const app = express();

app.disable('x-powered-by');

/**
 * CORS.
 *
 * A interface publicada fica em outro domínio que a API, então o navegador
 * pede autorização. A lista de origens vem de `ALLOWED_ORIGIN`, que aceita
 * uma lista separada por vírgula.
 *
 * A origem que não está na lista não recebe o cabeçalho de autorização — e o
 * navegador bloqueia a chamada. É o comportamento esperado: a API responde,
 * mas o navegador não entrega a resposta ao script.
 */
app.use(
  cors({
    origin: (origem, callback) => {
      // Sem origem: chamada de linha de comando, health check ou servidor
      // para servidor. Não é uma chamada de navegador, então não há o que
      // autorizar.
      if (!origem) {
        callback(null, true);
        return;
      }

      const normalizada = origem.replace(/\/+$/, '');
      if (env.allowedOrigins.includes(normalizada)) {
        callback(null, true);
        return;
      }

      console.warn(`Origem não liberada no CORS: ${normalizada}`);
      callback(null, false);
    },
  }),
);

app.use(express.json({ limit: '64kb' }));

/**
 * Liveness: a API está no ar.
 *
 * Não toca o banco de propósito. O health check do Render usa esta rota, e
 * ela precisa responder mesmo que o banco esteja hibernando — caso contrário
 * o serviço entra em reinício contínuo, que é mais caro do que esperar o
 * banco acordar.
 */
app.get('/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok' });
});

/**
 * Readiness: a API está no ar **e** o banco responde.
 *
 * Separada da liveness de propósito. Diz se o laboratório dá para usar agora,
 * sem punishing do reinício: quem consome é o monitoramento.
 */
app.get('/ready', async (_request: Request, response: Response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', banco: 'ok' });
  } catch {
    response.status(503).json({ status: 'indisponivel', banco: 'erro' });
  }
});

app.use('/api/v1/scenarios', scenariosRouter);

app.use('/api', (_request: Request, response: Response) => {
  response.status(404).json({ error: 'Rota não encontrada' });
});

app.use((erro: unknown, _request: Request, response: Response, _next: unknown) => {
  console.error('Erro interno:', erro instanceof Error ? erro.message : erro);
  response.status(500).json({ error: 'Erro interno' });
});
