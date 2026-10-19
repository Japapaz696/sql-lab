import { env } from '../config/env.js';
import { pool } from './pool.js';
import { prepararBanco } from './setup.js';

/**
 * Recria o schema e a carga fictícia.
 *
 *   npm run db:reset
 */
async function principal(): Promise<void> {
  console.log('Recriando schema e carga de dados fictícios...');
  await prepararBanco(pool);

  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*) FROM clientes)   AS clientes,
      (SELECT count(*) FROM produtos)   AS produtos,
      (SELECT count(*) FROM pedidos)    AS pedidos,
      (SELECT count(*) FROM itens_pedido) AS itens,
      (SELECT count(*) FROM pagamentos) AS pagamentos,
      (SELECT count(*) FROM estoque)    AS estoque,
      (SELECT count(*) FROM chamados)   AS chamados
  `);

  console.log('Pronto:', JSON.stringify(rows[0]));
  await pool.end();
}

principal().catch((erro: unknown) => {
  console.error('Falha ao preparar o banco:', erro instanceof Error ? erro.message : erro);
  console.error('Verifique DATABASE_URL em', env.rootDir);
  process.exit(1);
});
