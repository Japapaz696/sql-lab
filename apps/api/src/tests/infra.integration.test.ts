import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

import { app } from '../app.js';
import { pedir } from './http.js';

/**
 * A origem liberada pelo CORS no ambiente de teste.
 *
 * Vem do `.env`; falhar aqui é melhor do que testar com `undefined`, que não
 * prova nada sobre a configuração real.
 */
function origemLiberada(): string {
  const origem = (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0];

  if (!origem) throw new Error('ALLOWED_ORIGIN não está definido no ambiente de teste');
  return origem;
}

/**
 * A API é publicada em outro domínio que a interface, então o navegador
 * precisa de autorização. E o hosting gratuito hiberna, então a distinção
 * entre "a API está no ar" e "o banco respondeu" importa.
 */
describe('a API na internet', () => {
  let servidor: Server;
  let base: string;

  beforeAll(async () => {
    servidor = await new Promise<Server>((resolvido) => {
      const s = app.listen(0, () => resolvido(s));
    });
    const endereco = servidor.address();
    const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
    base = `http://127.0.0.1:${porta}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolvido) => servidor.close(() => resolvido()));
  });

  it('responde o health check sem tocar o banco', async () => {
    const resposta = await fetch(`${base}/health`);

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ status: 'ok' });
  });

  it('responde o readiness com o estado do banco', async () => {
    const resposta = await fetch(`${base}/ready`);

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ status: 'ok', banco: 'ok' });
  });

  it('libera as origens declaradas em ALLOWED_ORIGIN', async () => {
    const liberadas = (process.env.ALLOWED_ORIGIN ?? '').split(',').filter(Boolean);

    expect(liberadas.length).toBeGreaterThan(0);

    for (const origem of liberadas) {
      const resposta = await fetch(`${base}/health`, { headers: { Origin: origem } });
      expect(resposta.headers.get('access-control-allow-origin')).toBe(origem);
    }
  });

  it('não libera uma origem que não foi declarada', async () => {
    const resposta = await fetch(`${base}/health`, {
      headers: { Origin: 'https://origem-nao-declarada.invalid' },
    });

    expect(resposta.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responde a chamada sem origem, como a de um monitor', async () => {
    const resposta = await fetch(`${base}/health`);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('recusa uma rota que não existe, com JSON', async () => {
    const resposta = await fetch(`${base}/api/v1/inexistente`);

    expect(resposta.status).toBe(404);
    await expect(resposta.json()).resolves.toEqual({ error: 'Rota não encontrada' });
  });

  it('envia os cabeçalhos de segurança sem quebrar o CORS', async () => {
    const origem = origemLiberada();
    const resposta = await fetch(`${base}/health`, { headers: { Origin: origem } });

    expect(resposta.headers.get('x-content-type-options')).toBe('nosniff');
    expect(resposta.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(resposta.headers.get('referrer-policy')).toBe('no-referrer');
    expect(resposta.headers.get('strict-transport-security')).toContain('max-age=');
    // A interface fica em outro domínio: o recurso precisa ser liberado.
    expect(resposta.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    // E o CORS continua funcionando com o helmet na frente.
    expect(resposta.headers.get('access-control-allow-origin')).toBe(origem);
  });

  it('responde ao preflight do navegador antes de executar SQL', async () => {
    const origem = origemLiberada();
    const resposta = await fetch(`${base}/api/v1/scenarios/titulo-vencido/execute`, {
      method: 'OPTIONS',
      headers: {
        Origin: origem,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-sessao-id',
      },
    });

    expect(resposta.status).toBe(204);
    expect(resposta.headers.get('access-control-allow-origin')).toBe(origem);
    expect(resposta.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('responde 400 quando o corpo não é JSON válido', async () => {
    const resposta = await pedir(base, '/api/v1/scenarios/titulo-vencido/execute', {
      method: 'POST',
      sessao: 'corpo-malformado',
      body: '{quebrado',
    });

    expect(resposta.status).toBe(400);
    await expect(resposta.json()).resolves.toEqual({
      error: 'Corpo da requisição não é JSON válido.',
    });
  });
});
