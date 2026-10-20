import { Router, type Request, type Response } from 'express';

import { buscarCenario } from '../scenarios/index.js';
import { descreverEsquema } from '../services/schema.service.js';
import { avaliarCenario, detalharCenario, listarCenarios } from '../services/scenarios.service.js';
import { lerProgresso, registrarProgresso } from '../services/progress.service.js';
import { executarConsulta, explicarConsulta } from '../services/sql.service.js';

export const scenariosRouter = Router();

/**
 * No Express 5, os parâmetros de rota chegam como string | string[] | undefined.
 * Esta função normaliza o id do cenário.
 */
function idDoCenario(request: Request): string {
  const valor = request.params.id;
  return Array.isArray(valor) ? (valor[0] ?? '') : (valor ?? '');
}

/** Identificador da sessão de trabalho, para acompanhar o progresso. */
function sessaoDe(request: Request): string {
  const cabecalho = request.header('x-sessao-id');
  if (cabecalho && /^[A-Za-z0-9_-]{8,64}$/.test(cabecalho)) return cabecalho;
  return 'sem-sessao';
}

scenariosRouter.get('/', async (request: Request, response: Response) => {
  const progresso = await lerProgresso(sessaoDe(request));

  const cenarios = listarCenarios().map((cenario) => {
    const estado = progresso.get(cenario.id);
    return {
      ...cenario,
      resolvido: estado?.resolvido ?? false,
      tentativas: estado?.tentativas ?? 0,
    };
  });

  response.json({
    cenarios,
    progresso: {
      total: cenarios.length,
      resolvidos: cenarios.filter((cenario) => cenario.resolvido).length,
    },
  });
});

/**
 * O esquema do ERP, lido do catalogo do PostgreSQL.
 *
 * Serve para o aluno saber o que existe antes de escrever a consulta.
 *
 * Fica antes das rotas com parametro, para nao haver ambiguidade.
 */
scenariosRouter.get('/esquema/tabelas', async (_request: Request, response: Response) => {
  response.json({ tabelas: await descreverEsquema() });
});

scenariosRouter.get('/:id', async (request: Request, response: Response) => {
  const cenario = detalharCenario(idDoCenario(request));
  if (!cenario) {
    response.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  const progresso = await lerProgresso(sessaoDe(request));
  const estado = progresso.get(cenario.id);

  response.json({
    ...cenario,
    resolvido: estado?.resolvido ?? false,
    tentativas: estado?.tentativas ?? 0,
  });
});

scenariosRouter.post('/:id/execute', async (request: Request, response: Response) => {
  const sql = typeof request.body?.sql === 'string' ? request.body.sql : '';

  const avaliacao = await avaliarCenario(idDoCenario(request), sql);
  if (!avaliacao) {
    response.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  const consulta = await executarConsulta(sql);
  const progresso = await registrarProgresso(
    sessaoDe(request),
    idDoCenario(request),
    avaliacao.verificacao.acertou,
  );

  response.json({
    consulta,
    verificacao: avaliacao.verificacao,
    tentativas: progresso.tentativas,
    resolvido: progresso.resolvido,
  });
});

scenariosRouter.post('/:id/explain', async (request: Request, response: Response) => {
  const sql = typeof request.body?.sql === 'string' ? request.body.sql : '';
  response.json(await explicarConsulta(sql));
});

scenariosRouter.get('/:id/solucao', (request: Request, response: Response) => {
  const cenario = buscarCenario(idDoCenario(request));
  if (!cenario) {
    response.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  response.json({ sqlReferencia: cenario.sqlReferencia, explicacao: cenario.explicacao });
});
