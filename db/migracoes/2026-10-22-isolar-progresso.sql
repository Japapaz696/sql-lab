-- =============================================================
-- SQL Lab — isolar a tabela interna de progresso (produção)
-- =============================================================
--
-- Esta migração reproduz, em um banco que já está no ar, o que
-- `db/privilegios.sql` passou a fazer na preparação: o papel de execução
-- (`sql_lab_exec`) perde qualquer acesso a `progresso_cenarios` e continua
-- com SELECT apenas nas nove tabelas do ERP.
--
-- Por que isso importa: a tabela guarda o progresso de todas as sessões. Com
-- SELECT nela, qualquer pessoa que descubra uma sessão alheia poderia lê-la
-- pela rota de consulta livre — o isolamento por sessão na API não protegia o
-- dado no banco. A API também deixa de listar a tabela no esquema do ERP.
--
-- Como executar (quando autorizado):
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 \
--     -f db/migracoes/2026-10-22-isolar-progresso.sql
--
-- Requisitos:
--   * rodar com o DONO do schema (o usuário de `DATABASE_ADMIN_URL`), não com
--     `sql_lab_exec`;
--   * `sql_lab_exec` precisa existir (é criado por `db/privilegios.sql`).
--
-- É idempotente: pode ser executada mais de uma vez sem efeito colateral.
-- A reversão está no fim do arquivo, comentada.
-- =============================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sql_lab_exec') THEN
    RAISE EXCEPTION
      'O papel sql_lab_exec não existe neste banco. Rode db/privilegios.sql antes desta migração.';
  END IF;
END
$$;

-- 1. Desfaz a concessão padrão para tabelas futuras. Sem isso, a próxima
--    tabela criada pelo dono voltaria a ser legível pelo papel de execução.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT ON TABLES FROM sql_lab_exec;

-- 2. Fecha a tabela interna, inclusive se houver concessão direta anterior.
REVOKE ALL ON TABLE public.progresso_cenarios FROM sql_lab_exec;

-- 3. Reafirma a leitura apenas nas tabelas do ERP (idempotente).
GRANT SELECT ON TABLE
  public.chamados,
  public.clientes,
  public.depositos,
  public.estoque,
  public.itens_pedido,
  public.movimentacoes_estoque,
  public.pagamentos,
  public.pedidos,
  public.produtos
TO sql_lab_exec;

COMMIT;

-- -------------------------------------------------------------
-- Verificação (roda depois do COMMIT; não altera nada)
-- -------------------------------------------------------------
--
-- Deve devolver `pode_ler_progresso = false`:
--
--   SELECT has_table_privilege('sql_lab_exec', 'public.progresso_cenarios', 'SELECT')
--          AS pode_ler_progresso;
--
-- Deve devolver nove linhas, todas com `pode_ler = true`:
--
--   SELECT tablename,
--          has_table_privilege('sql_lab_exec', format('public.%I', tablename), 'SELECT')
--            AS pode_ler
--   FROM pg_tables
--   WHERE schemaname = 'public' AND tablename <> 'progresso_cenarios'
--   ORDER BY tablename;
--
-- E a API, ao listar o esquema, deve devolver exatamente essas nove tabelas.
--
-- -------------------------------------------------------------
-- Reversão (somente se necessário; desfaz o isolamento)
-- -------------------------------------------------------------
--
--   GRANT SELECT ON TABLE public.progresso_cenarios TO sql_lab_exec;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT ON TABLES TO sql_lab_exec;
--
-- A reversão reabre a leitura de todas as sessões pelo papel de execução.
-- Prefira corrigir a causa em vez de reverter.
