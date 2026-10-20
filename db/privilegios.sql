-- =============================================================
-- SQL Lab — separação de privilégios
-- =============================================================
--
-- O laboratório executa SQL escrito por quem usa a interface. A proteção
-- principal é o protocolo estendido (uma instrução por consulta) e a
-- transação READ ONLY. Este arquivo adiciona uma terceira camada, do lado
-- do servidor: um papel que só pode ler.
--
-- Dois papéis:
--
--   <dono do schema>  dono do schema. Usado APENAS para preparar o banco
--                      (criar tabelas, índices e a carga) e para gravar o
--                      progresso da aplicação.
--   sql_lab_exec       o papel que executa as consultas do aluno. Tem
--                      SELECT e nada mais — nem INSERT, nem UPDATE, nem DELETE,
--                      nem CREATE.
--
-- A senha do papel de execução NÃO fica neste arquivo. Ela chega por uma
-- variável de sessão do PostgreSQL, `sql_lab.exec_password`, que a aplicação
-- define com set_config() — ou seja, como parâmetro, nunca concatenada no
-- texto do SQL. Se a variável não estiver definida, o script falha com uma
-- mensagem clara, em vez de criar o papel com uma senha previsível.

-- A senha chega aqui por parâmetro; o escopo da sessão é a transação atual.
DO $$
DECLARE
  senha text := current_setting('sql_lab.exec_password', true);
  papel text := 'sql_lab_exec';
BEGIN
  IF senha IS NULL OR senha = '' THEN
    RAISE EXCEPTION
      'A senha do papel de execução não foi informada (sql_lab.exec_password). '
      'Defina SQL_LAB_EXEC_PASSWORD antes de preparar o banco.';
  END IF;

  IF senha = papel THEN
    RAISE EXCEPTION
      'A senha do papel de execução não pode ser igual ao nome do papel.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
    -- O papel já existe: a senha é redefinida com o valor informado, e as
    -- concessões abaixo são reaplicadas.
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', papel, senha);
    RAISE NOTICE 'Papel % reaplicado.', papel;
  ELSE
    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', papel, senha);
    RAISE NOTICE 'Papel % criado.', papel;
  END IF;
END
$$;

-- O papel de execução precisa enxergar o schema e ler as tabelas.
GRANT USAGE ON SCHEMA public TO sql_lab_exec;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sql_lab_exec;

-- E precisa poder entrar no banco. Em hospedagens gerenciadas o papel novo
-- não vem com CONNECT, e a conexão falha antes de qualquer consulta.
DO $$
DECLARE
  banco text := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sql_lab_exec', banco);
END
$$;

-- Tabelas criadas depois também entram na concessão.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sql_lab_exec;

-- E nada além de leitura: a revogação é explícita, para ficar claro que a
-- ausência de privilégio é intencional e não um esquecimento.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM sql_lab_exec;

-- Sem DDL: o papel de execução não cria nem derruba nada.
REVOKE CREATE ON SCHEMA public FROM sql_lab_exec;

-- Nem privilégio no próprio banco: não pode criar objetos, nem schemas, nem
-- instalar extensões. O nome do banco é resolvido em tempo de execução, porque
-- CURRENT_DATABASE é uma função e não serve como alvo direto.
DO $$
DECLARE
  banco text := current_database();
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM sql_lab_exec', banco);
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM sql_lab_exec', banco);
END
$$;
