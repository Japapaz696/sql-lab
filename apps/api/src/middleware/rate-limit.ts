import { rateLimit, type AugmentedRequest } from 'express-rate-limit';

import { env } from '../config/env.js';

type OpcoesDoLimite = {
  /** Quantas requisições cada IP pode fazer dentro da janela. */
  max: number;
  /** Tamanho da janela em milissegundos. */
  janelaMs?: number;
};

/**
 * Limite de requisições por IP.
 *
 * A resposta de bloqueio é JSON — como todo o resto da API — e traz
 * `Retry-After` em segundos, além dos cabeçalhos `RateLimit-*`. Sem isso, um
 * cliente legítimo que passou do limite receberia só um 429 opaco e insistiria
 * imediatamente.
 *
 * O IP vem de `request.ip`. O Express está com `trust proxy = 1` porque o
 * Render termina o TLS na frente da aplicação; sem esse ajuste, todo mundo
 * compartilharia o IP do proxy e uma pessoa bloquearia as outras.
 */
export function criarLimitador({ max, janelaMs = env.rateLimitWindowMs }: OpcoesDoLimite) {
  return rateLimit({
    windowMs: janelaMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (request, response) => {
      const reinicio = (request as AugmentedRequest).rateLimit?.resetTime;
      const segundos = reinicio
        ? Math.max(1, Math.ceil((reinicio.getTime() - Date.now()) / 1000))
        : Math.ceil(janelaMs / 1000);

      response.set('Retry-After', String(segundos));
      response.status(429).json({
        error: `Muitas consultas em pouco tempo. Aguarde ${segundos} segundo(s) e tente de novo.`,
        retryAfterSeconds: segundos,
      });
    },
  });
}
