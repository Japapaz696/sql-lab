import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { criarLimitador } from './middleware/rate-limit.js';
import { scenariosRouter } from './routes/scenarios.routes.js';
import { ErroDeSobrecarga } from './services/concorrencia.js';

export type OpcoesDoApp = {
  /** Sobrescreve o limite de `/execute` (usado nos testes). */
  limiteDeExecucao?: number;
  /** Sobrescreve o limite de `/explain` (usado nos testes). */
  limiteDeExplicacao?: number;
  /** Sobrescreve a janela dos limites (usado nos testes). */
  janelaDoLimiteMs?: number;
};

/**
 * Monta a aplicação.
 *
 * É uma fábrica, e não um `app` pronto, para que os testes possam criar uma
 * instância com limites baixos sem mexer em variável de ambiente nem no
 * processo inteiro. Em produção, `app` é criado uma única vez.
 */
export function criarApp(opcoes: OpcoesDoApp = {}): express.Express {
  const app = express();
  const janela = opcoes.janelaDoLimiteMs ?? env.rateLimitWindowMs;

  /**
   * O Render fica na frente da aplicação e acrescenta o IP real em
   * `X-Forwarded-For`. Confiar em exatamente um salto é o que faz o rate limit
   * enxergar o cliente — e não o proxy — sem aceitar um cabeçalho forjado
   * pelo cliente.
   */
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /**
   * Cabeçalhos de segurança. A API devolve JSON, então a CSP de página não
   * acrescenta proteção e só criaria manutenção extra; o resto do conjunto
   * (nosniff, frame-options, referrer-policy, HSTS) vale.
   *
   * O CORP é `cross-origin` porque a interface roda em outro domínio (GitHub
   * Pages): o padrão `same-origin` bloquearia recursos servidos por esta API.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

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

  /**
   * Os limites entram antes do router, nas duas rotas que executam SQL. O
   * router continua dono do comportamento; o middleware só decide se a
   * requisição chega até ele.
   */
  app.post(
    '/api/v1/scenarios/:id/execute',
    criarLimitador({ max: opcoes.limiteDeExecucao ?? env.rateLimitExecuteMax, janelaMs: janela }),
  );
  app.post(
    '/api/v1/scenarios/:id/explain',
    criarLimitador({
      max: opcoes.limiteDeExplicacao ?? env.rateLimitExplainMax,
      janelaMs: janela,
    }),
  );

  app.use('/api/v1/scenarios', scenariosRouter);

  app.use('/api', (_request: Request, response: Response) => {
    response.status(404).json({ error: 'Rota não encontrada' });
  });

  app.use((erro: unknown, _request: Request, response: Response, _next: NextFunction) => {
    /**
     * A fila de consultas estourou o tempo de espera: não é erro interno, é
     * sobrecarga. `503` com `Retry-After` diz ao cliente exatamente o que
     * fazer, em vez de um `500` que sugere bug.
     */
    if (erro instanceof ErroDeSobrecarga) {
      response.set('Retry-After', String(erro.retryAfterSeconds)).status(503).json({
        error:
          'O laboratório está com muitas consultas ao mesmo tempo. Tente de novo em alguns segundos.',
        retryAfterSeconds: erro.retryAfterSeconds,
      });
      return;
    }

    /**
     * JSON malformado é erro de quem chamou, não da API. O `express.json`
     * marca esse caso com `entity.parse.failed`; sem o tratamento, viraria
     * "500 Erro interno" e esconderia a causa de quem está integrando.
     */
    if (erro && typeof erro === 'object' && 'type' in erro && erro.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Corpo da requisição não é JSON válido.' });
      return;
    }

    console.error('Erro interno:', erro instanceof Error ? erro.message : erro);
    response.status(500).json({ error: 'Erro interno' });
  });

  return app;
}

export const app = criarApp();
