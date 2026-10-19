import type { CellValue, ExplainRow, QueryOutcome, ResultRow } from '@sql-lab/shared';

import { env } from '../config/env.js';
import { withReadOnlyClient } from '../database/pool.js';

type Coluna = { name: string; dataTypeID: number };

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
    return mensagem
      .replace(/^.*?:\s*/, '')
      .replace(/^ERROR:\s*/, '')
      .trim();
  }
  return 'Erro desconhecido na consulta';
}

/**
 * Executa uma consulta escrita pelo aluno.
 *
 * A consulta roda dentro de uma transação READ ONLY, com tempo limite, e o
 * resultado é truncado no limite configurado. Erros de sintaxe ou de
 * referência voltam como texto legível, com a mensagem do PostgreSQL.
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
    return await withReadOnlyClient(async (client) => {
      const resultado = await client.query({ text: texto, rowMode: 'array' });
      const colunas: Coluna[] = resultado.fields ?? [];
      const linhas: ResultRow[] = resultado.rows.map((linha) => linha.map(normalizar));
      const truncado = linhas.length > env.maxResultRows;
      const limitadas = truncado ? linhas.slice(0, env.maxResultRows) : linhas;

      return {
        ok: true,
        colunas: colunas.map((coluna) => coluna.name),
        linhas: limitadas,
        totalLinhas: linhas.length,
        truncado,
        duracaoMs: Date.now() - inicio,
      };
    });
  } catch (erro) {
    return {
      ok: false,
      colunas: [],
      linhas: [],
      totalLinhas: 0,
      truncado: false,
      duracaoMs: Date.now() - inicio,
      erro: mensagemDeErro(erro),
    };
  }
}

/**
 * Devolve o plano de execução da consulta, para mostrar qual índice foi usado.
 *
 * É a parte do laboratório que conecta "a consulta funciona" com "a consulta
 * funciona rápido": o aluno vê o `Index Scan` no plano.
 */
export async function explicarConsulta(
  sql: string,
): Promise<{ linhas: ExplainRow[]; erro?: string }> {
  const texto = sql.trim();
  if (!texto) {
    return { linhas: [], erro: 'Escreva uma consulta SQL antes de explicar.' };
  }

  try {
    return await withReadOnlyClient(async (client) => {
      const resultado = await client.query({
        text: `EXPLAIN (COSTS OFF, FORMAT TEXT) ${texto}`,
        rowMode: 'array',
      });
      const linhas: ExplainRow[] = resultado.rows.map((linha) => ({
        chave: String(linha[0] ?? ''),
        detalhe: String(linha[1] ?? ''),
      }));
      return { linhas };
    });
  } catch (erro) {
    return { linhas: [], erro: mensagemDeErro(erro) };
  }
}
