import cors from 'cors';
import express, { type Request, type Response } from 'express';

import { env } from './config/env.js';
import { scenariosRouter } from './routes/scenarios.routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.allowedOrigin }));
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok' });
});

app.use('/api/v1/scenarios', scenariosRouter);

app.use('/api', (_request: Request, response: Response) => {
  response.status(404).json({ error: 'Rota não encontrada' });
});

app.use((erro: unknown, _request: Request, response: Response, _next: unknown) => {
  console.error('Erro interno:', erro instanceof Error ? erro.message : erro);
  response.status(500).json({ error: 'Erro interno' });
});
