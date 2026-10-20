import { env } from '../config/env.js';
import { poolAdmin } from '../database/pool.js';
import { prepararBanco } from './setup.js';

/**
 * Recria o schema, a carga e as concessões de privilégio.
 *
 * Usa a conexão administrativa: quem prepara o banco precisa de permissão
 * para criar tabelas e para conceder leitura ao papel de execução.
 *
 *   npm run db:reset
 */
async function principal(): Promise<void> {
  if (!poolAdmin) {
    console.error('DATABASE_ADMIN_URL ausente: defina a conexão do usuário dono do schema.');
    process.exit(1);
  }

  console.log('Recriando schema, carga fictícia e concessões...');
  await prepararBanco(poolAdmin);

  const { rows } = await poolAdmin.query(`
    SELECT
      (SELECT count(*)::int FROM clientes)     AS clientes,
      (SELECT count(*)::int FROM produtos)     AS produtos,
      (SELECT count(*)::int FROM pedidos)      AS pedidos,
      (SELECT count(*)::int FROM itens_pedido) AS itens,
      (SELECT count(*)::int FROM pagamentos)   AS pagamentos,
      (SELECT count(*)::int FROM estoque)      AS estoque,
      (SELECT count(*)::int FROM chamados)     AS chamados
  `);

  console.log('Pronto:', JSON.stringify(rows[0]));

  const { rows: permissoes } = await poolAdmin.query(`
    SELECT DISTINCT privilege_type
    FROM information_schema.role_table_grants
    WHERE grantee = 'sql_lab_exec' AND table_schema = 'public'
    ORDER BY privilege_type
  `);

  if (permissoes.length) {
    console.log(`Papel de execução: ${permissoes.map((p) => p.privilege_type).join(', ')}`);
  } else {
    console.log(
      'Aviso: o papel de execução não foi encontrado. O laboratório segue protegido ' +
        'pela transação somente leitura e pelo protocolo estendido.',
    );
  }

  await poolAdmin.end();
}

principal().catch((erro: unknown) => {
  console.error('Falha ao preparar o banco:', erro instanceof Error ? erro.message : erro);
  console.error('Verifique DATABASE_ADMIN_URL em', env.rootDir);
  process.exit(1);
});
