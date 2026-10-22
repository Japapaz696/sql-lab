import type { CellValue, ExplainRow, QueryOutcome } from '@sql-lab/shared';

import { env } from '../config/env.js';
import { lerComLimite, withReadOnlyClient } from '../database/pool.js';
import { ErroDeSobrecarga, semaforoDeConsultas } from './concorrencia.js';

/**
 * Normaliza um valor do PostgreSQL para algo que o JSON transporte sem
 * surprises: `numeric` vem como string, `date` como Date, `int8` como string.
 */
function normalizar(valor: unknown): CellValue {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
    return valor;
  }
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'bigint') return valor.toString();
  if (Buffer.isBuffer(valor)) return `[${valor.length} bytes]`;
  if (Array.isArray(valor)) return `[${valor.length} itens]`;
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

function mensagemDeErro(erro: unknown): string {
  if (erro && typeof erro === 'object' && 'message' in erro) {
    const mensagem = String((erro as { message: unknown }).message);
    // Remove a posição no arquivo: ela é irrelevante para quem está aprendendo.
    const limpa = mensagem
      .replace(/^.*?:\s*/, '')
      .replace(/^ERROR:\s*/, '')
      .trim();
    return limpa || 'Erro na consulta.';
  }
  return 'Erro desconhecido na consulta.';
}

/**
 * Traduz os erros mais comuns do PostgreSQL em algo que ajude quem está
 * aprendendo, em vez de despejar a mensagem técnica.
 */
function explicarErro(mensagem: string): string {
  const texto = mensagem.toLowerCase();

  if (texto.includes('cannot insert multiple commands')) {
    return 'Só é permitida uma instrução por consulta. Rode as consultas uma de cada vez.';
  }
  if (texto.includes('read-only transaction')) {
    return 'Esta consulta tentaria escrever no banco. O laboratório é de leitura: filtre e consulte, sem alterar dados.';
  }
  if (texto.includes('permission denied') && texto.includes('progresso_cenarios')) {
    return 'Esta tabela é de uso interno do laboratório, não faz parte do ERP. Use as tabelas listadas no esquema.';
  }
  if (texto.includes('permission denied')) {
    return 'O usuário de execução do laboratório só tem permissão de leitura.';
  }
  if (texto.includes('does not exist') && texto.includes('relation')) {
    return 'Tabela ou visão inexistente. Confira o nome no esquema do ERP.';
  }
  if (texto.includes('column') && texto.includes('does not exist')) {
    return 'Coluna inexistente. confira o nome das colunas da tabela.';
  }
  if (texto.includes('syntax error')) {
    return 'Erro de sintaxe. Verifique as palavras-chave e a ordem das cláusulas.';
  }
  if (texto.includes('canceling statement due to statement timeout')) {
    return `A consulta passou do tempo limite de ${env.queryTimeoutMs} ms. Tente reduzir o volume ou adicionar um filtro.`;
  }
  if (texto.includes('division by zero')) {
    return 'Divisão por zero: alguma linha tem denominador zero. Trate o caso antes de dividir.';
  }
  if (texto.includes('invalid input syntax for type uuid')) {
    return 'Um identificador UUID inválido. Confira se a coluna recebeu um UUID válido.';
  }
  if (texto.includes('more than one row returned by a subquery')) {
    return 'A subconsulta devolveu mais de uma linha, mas o contexto espera no máximo uma.';
  }

  return mensagem;
}

/**
 * Executa uma consulta escrita pelo aluno.
 *
 * Três camadas de proteção, todas no servidor:
 *
 *  1. o cursor usa o protocolo estendido, que aceita uma única instrução —
 *     por isso "COMMIT; UPDATE ..." nem chega a ser executado;
 *  2. a transação é READ ONLY, então nem uma instrução simples de escrita
 *     passa;
 *  3. o usuário do banco tem apenas SELECT, então a escrita é recusada mesmo
 *     fora de uma transação somente leitura.
 *
 * O resultado é lido em lotes e a leitura para no limite configurado: a
 * consulta não traz um milhão de linhas para a memória do processo.
 */
export async function executarConsulta(sql: string): Promise<QueryOutcome> {
  const inicio = Date.now();
  const texto = sql.trim();

  if (!texto) {
    return {
      ok: false,
      colunas: [],
      linhas: [],
      totalLinhas: 0,
      truncado: false,
      duracaoMs: 0,
      erro: 'Escreva uma consulta SQL antes de executar.',
    };
  }

  try {
    return await semaforoDeConsultas.executar(() =>
      withReadOnlyClient(async (client) => {
        const { linhas, colunas, truncado } = await lerComLimite(client, texto, env.maxResultRows);

        return {
          ok: true,
          colunas,
          linhas: linhas.map((linha) => linha.map(normalizar)),
          totalLinhas: linhas.length,
          truncado,
          duracaoMs: Date.now() - inicio,
        };
      }),
    );
  } catch (erro) {
    // Sobrecarga não é erro de SQL: precisa chegar ao tratador da API para
    // virar 503 com Retry-After, e não um 200 com "erro na consulta".
    if (erro instanceof ErroDeSobrecarga) throw erro;

    return {
      ok: false,
      colunas: [],
      linhas: [],
      totalLinhas: 0,
      truncado: false,
      duracaoMs: Date.now() - inicio,
      erro: explicarErro(mensagemDeErro(erro)),
    };
  }
}

/**
 * Devolve o plano de execução da consulta, para mostrar qual índice foi usado.
 *
 * É a parte do laboratório que conecta "a consulta funciona" com "a consulta
 * funciona rápido": o aluno vê o `Index Scan` no plano.
 *
 * O `EXPLAIN` não executa a consulta, e o cursor impede que várias
 * instruções sejam enviadas juntas.
 */
export async function explicarConsulta(
  sql: string,
): Promise<{ linhas: ExplainRow[]; erro?: string }> {
  const texto = sql.trim();
  if (!texto) {
    return { linhas: [], erro: 'Escreva uma consulta SQL antes de explicar.' };
  }

  try {
    return await semaforoDeConsultas.executar(() =>
      withReadOnlyClient(async (client) => {
        const { linhas } = await lerComLimite(
          client,
          `EXPLAIN (COSTS OFF, FORMAT TEXT) ${texto}`,
          200,
        );
        const explicacao: ExplainRow[] = linhas.map((linha) => ({
          chave: String(linha[0] ?? ''),
          detalhe: String(linha[1] ?? ''),
        }));
        return { linhas: explicacao };
      }),
    );
  } catch (erro) {
    if (erro instanceof ErroDeSobrecarga) throw erro;
    return { linhas: [], erro: explicarErro(mensagemDeErro(erro)) };
  }
}
