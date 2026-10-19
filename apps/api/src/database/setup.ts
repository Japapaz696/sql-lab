import type { Pool } from 'pg';

import { env } from '../config/env.js';
import { pool } from './pool.js';

/**
 * Aplica o schema e a carga de dados fictícios.
 *
 * O schema é recreado do zero a cada execução: o laboratório precisa de um
 * estado conhecido, e um `DROP SCHEMA` garante que uma execução anterior não
 * deixe resíduo.
 */
export async function prepararBanco(alvo: Pool = pool): Promise<void> {
  const client = await alvo.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');

    const schema = await import('node:fs/promises').then((fs) =>
      fs.readFile(`${env.rootDir}/db/schema.sql`, 'utf8'),
    );
    await client.query(schema);

    const seed = await import('node:fs/promises').then((fs) =>
      fs.readFile(`${env.rootDir}/db/seed.sql`, 'utf8'),
    );
    await client.query(seed);
  } finally {
    client.release();
  }
}

export async function contarRegistros(tabela: string, alvo: Pool = pool): Promise<number> {
  const { rows } = await alvo.query(`SELECT count(*)::int AS total FROM ${tabela}`);
  return rows[0]?.total ?? 0;
}
