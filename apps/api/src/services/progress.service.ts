import type pg from 'pg';

import { poolDeEscrita } from '../database/pool.js';

export type ProgressoDoCenario = {
  tentativas: number;
  resolvido: boolean;
};

/**
 * Progresso do aluno no laboratorio.
 *
 * A chave e a sessao do navegador: um identificador aleatorio gerado no
 * cliente. Nao guarda nome, e-mail nem documento — so o estado do exercicio.
 *
 * A gravacao usa a conexao da aplicacao (o usuario dono do esquema), e nao a
 * conexao de consulta — que e somente leitura de proposito. Se a gravacao
 * falhar, o laboratorio continua funcionando: e uma perda de historico, nao um
 * erro para quem esta aprendendo.
 */
export async function registrarProgresso(
  sessaoId: string,
  cenarioId: string,
  acertou: boolean,
  executor: pg.Pool | pg.PoolClient = poolDeEscrita(),
): Promise<ProgressoDoCenario> {
  const resolvidoEm = acertou ? new Date() : null;

  try {
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
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.warn('Nao foi possivel registrar o progresso:', mensagem);
    return { tentativas: 1, resolvido: acertou };
  }
}

/**
 * Le o progresso de uma sessao: quantas tentativas e quais cenarios ja
 * foram resolvidos.
 */
export async function lerProgresso(
  sessaoId: string,
  executor: pg.Pool | pg.PoolClient = poolDeEscrita(),
): Promise<Map<string, ProgressoDoCenario>> {
  try {
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
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.warn('Nao foi possivel ler o progresso:', mensagem);
    return new Map();
  }
}
