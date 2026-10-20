import { env } from '../config/env.js';
import { poolAdmin } from '../database/pool.js';
import { prepararBanco } from './setup.js';

/**
 * Recria o schema, a carga e as concessões de privilégio.
 *
 * A carga recria o schema inteiro, então o comando se recusa a rodar em um
 * banco que não tenha a cara de um banco de laboratório, e exige confirmação
 * explícita. Veja `setup.ts` para as regras.
 *
 *   $env:SQL_LAB_CONFIRMAR_RESET = "sim"
 *   $env:SQL_LAB_EXEC_PASSWORD = "<senha forte, 16+ caracteres>"
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

  const tipos = permissoes.map((p) => p.privilege_type);
  if (tipos.length === 1 && tipos[0] === 'SELECT') {
    console.log('Papel de execução: SELECT (e nada mais)');
  } else if (tipos.length === 0) {
    console.log(
      'Aviso: o papel sql_lab_exec não foi encontrado. O laboratório segue protegido ' +
        'pela transação somente leitura e pelo protocolo estendido, mas a camada de ' +
        'privilégio de banco não está de pé — e a API não vai subir em produção.',
    );
  } else {
    console.log(
      `Aviso: o papel de execução tem privilégios além de SELECT: ${tipos.join(', ')}. ` +
        'Corrija antes de publicar.',
    );
  }

  await poolAdmin.end();
}

principal().catch((erro: unknown) => {
  console.error('Falha ao preparar o banco:', erro instanceof Error ? erro.message : erro);
  console.error('Verifique DATABASE_ADMIN_URL em', env.rootDir);
  process.exit(1);
});
