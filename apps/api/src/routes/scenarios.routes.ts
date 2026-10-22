import { Router, type Request, type Response } from 'express';

import { buscarCenario } from '../scenarios/index.js';
import { descreverEsquema } from '../services/schema.service.js';
import { avaliarCenario, detalharCenario, listarCenarios } from '../services/scenarios.service.js';
import { lerProgresso, registrarProgresso } from '../services/progress.service.js';
import { explicarConsulta } from '../services/sql.service.js';

export const scenariosRouter = Router();

/**
 * No Express 5, os parâmetros de rota chegam como string | string[] | undefined.
 * Esta função normaliza o id do cenário.
 */
function idDoCenario(request: Request): string {
  const valor = request.params.id;
  return Array.isArray(valor) ? (valor[0] ?? '') : (valor ?? '');
}

/** Formato aceito para a sessão: o mesmo que o cliente gera (16 bytes em hex). */
const PADRAO_DE_SESSAO = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Identificador da sessão de trabalho, obrigatório nas rotas que leem ou
 * gravam progresso.
 *
 * Antes, a ausência do cabeçalho caía em uma sessão compartilhada
 * (`'sem-sessao'`): dois clientes sem o cabeçalho viam o progresso um do outro.
 * Agora a rota responde 400 e explica como enviar o identificador — um erro
 * explícito é melhor do que um estado compartilhado silencioso.
 */
function sessaoDaRequisicao(request: Request, response: Response): string | null {
  const cabecalho = request.header('x-sessao-id')?.trim() ?? '';

  if (!PADRAO_DE_SESSAO.test(cabecalho)) {
    response.status(400).json({
      error:
        'Cabeçalho x-sessao-id ausente ou inválido. Envie de 8 a 64 caracteres: letras, números, hífen ou sublinhado.',
    });
    return null;
  }

  return cabecalho;
}

scenariosRouter.get('/', async (request: Request, response: Response) => {
  const sessao = sessaoDaRequisicao(request, response);
  if (!sessao) return;

  const progresso = await lerProgresso(sessao);

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
  const sessao = sessaoDaRequisicao(request, response);
  if (!sessao) return;

  const cenario = detalharCenario(idDoCenario(request));
  if (!cenario) {
    response.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  const progresso = await lerProgresso(sessao);
  const estado = progresso.get(cenario.id);

  response.json({
    ...cenario,
    resolvido: estado?.resolvido ?? false,
    tentativas: estado?.tentativas ?? 0,
  });
});

scenariosRouter.post('/:id/execute', async (request: Request, response: Response) => {
  const sessao = sessaoDaRequisicao(request, response);
  if (!sessao) return;

  const sql = typeof request.body?.sql === 'string' ? request.body.sql : '';

  const avaliacao = await avaliarCenario(idDoCenario(request), sql);
  if (!avaliacao) {
    response.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  const progresso = await registrarProgresso(
    sessao,
    idDoCenario(request),
    avaliacao.verificacao.acertou,
  );

  /**
   * `avaliacao.consulta` é o resultado que a avaliação já produziu. Executar
   * o mesmo SQL de novo aqui era trabalho duplicado — e pressão desnecessária
   * sobre o pool.
   */
  response.json({
    consulta: avaliacao.consulta,
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
