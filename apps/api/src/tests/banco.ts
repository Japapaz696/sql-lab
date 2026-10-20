import pg from 'pg';

/**
 * Conexão administrativa para os testes.
 *
 * A preparação do banco (criar tabelas e conceder privilégios) exige um usuário
 * que seja dono do schema. O papel de execução não é — e não deve ser.
 *
 * Cada arquivo de teste abre a sua e fecha no fim, para não disputar a
 * conexão com os outros arquivos da suíte.
 */
export function abrirBancoAdministrativo(): pg.Pool {
  return new pg.Pool({
    connectionString:
      process.env.TEST_DATABASE_ADMIN_URL ??
      process.env.DATABASE_ADMIN_URL ??
      process.env.TEST_DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10_000,
  });
}
