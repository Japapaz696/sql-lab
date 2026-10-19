import pg from 'pg';

import { env } from '../config/env.js';

const { Pool } = pg;

/**
 * Conexão da aplicação.
 *
 * `default_transaction_read_only` garante, no nível do servidor, que nenhuma
 * consulta do laboratório consiga escrever no banco — mesmo que a consulta
 * enviada pelo aluno peça um `UPDATE` ou um `DROP`. A proteção não depende de
 * a aplicação confiar no texto da consulta.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (erro) => {
  console.error('Erro de conexão com o banco:', erro.message);
});

/**
 * Conexão de leitura, usada para executar as consultas do aluno.
 *
 * A transação é aberta como READ ONLY e a instrução tem tempo limite, de modo
 * que uma consulta pesada não segure a conexão nem derrube o serviço.
 */
export async function withReadOnlyClient<T>(
  operacao: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${env.queryTimeoutMs}`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${env.queryTimeoutMs}`);
    const resultado = await operacao(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    client.release();
  }
}
