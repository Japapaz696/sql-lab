import type pg from 'pg';

import { pool } from '../database/pool.js';

export type ProgressoDoCenario = {
  tentativas: number;
  resolvido: boolean;
};

/**
 * Progresso do aluno no laboratório.
 *
 * A chave é a sessão do navegador: um identificador aleatório gerado no
 * cliente. Não guarda nome, e-mail nem documento — só o estado do exercício.
 */
export async function registrarProgresso(
  sessaoId: string,
  cenarioId: string,
  acertou: boolean,
  executor: pg.Pool | pg.PoolClient = pool,
): Promise<ProgressoDoCenario> {
  const resolvidoEm = acertou ? new Date() : null;

  const { rows } = await executor.query<{ tentativas: number; resolvido_em: Date | null }>(
    `INSERT INTO progresso_cenarios (sessao_id, cenario_id, tentativas, resolvido_em)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (sessao_id, cenario_id) DO UPDATE
       SET tentativas = progresso_cenarios.tentativas + 1,
           resolvido_em = COALESCE(progresso_cenarios.resolvido_em, EXCLUDED.resolvido_em)
     RETURNING tentativas, resolvido_em`,
    [sessaoId, cenarioId, resolvidoEm],
  );

  const linha = rows[0];
  return {
    tentativas: linha?.tentativas ?? 1,
    resolvido: linha?.resolvido_em != null,
  };
}

/**
 * Lê o progresso de uma sessão: quantas tentativas e quais cenários já
 * foram resolvidos.
 */
export async function lerProgresso(
  sessaoId: string,
  executor: pg.Pool | pg.PoolClient = pool,
): Promise<Map<string, ProgressoDoCenario>> {
  const { rows } = await executor.query<{
    cenario_id: string;
    tentativas: number;
    resolvido_em: Date | null;
  }>('SELECT cenario_id, tentativas, resolvido_em FROM progresso_cenarios WHERE sessao_id = $1', [
    sessaoId,
  ]);

  const mapa = new Map<string, ProgressoDoCenario>();
  for (const linha of rows) {
    mapa.set(linha.cenario_id, {
      tentativas: linha.tentativas,
      resolvido: linha.resolvido_em !== null,
    });
  }
  return mapa;
}
