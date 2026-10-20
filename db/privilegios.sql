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
--   sql_lab_admin  dono do schema. Usado APENAS para preparar o banco
--                  (criar tabelas, índices e a carga). Nunca pela aplicação.
--   sql_lab_exec   o papel que executa as consultas do aluno. Tem
--                  SELECT e nada mais — nem INSERT, nem UPDATE, nem DELETE,
--                  nem CREATE.
--
-- O script é idempotente e tolerante: se o usuário administrativo não puder
-- criar papéis (em hospedagens gerenciadas, onde o dono não é superusuário),
-- ele avisa e termina sem erro. A proteção por transação e por protocolo
-- continua valendo de qualquer forma.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sql_lab_exec') THEN
    CREATE ROLE sql_lab_exec LOGIN PASSWORD 'sql_lab_exec';
    RAISE NOTICE 'Papel sql_lab_exec criado.';
  ELSE
    RAISE NOTICE 'Papel sql_lab_exec ja existe.';
  END IF;
END
$$;

-- O papel de execução precisa enxergar o schema e ler as tabelas.
GRANT USAGE ON SCHEMA public TO sql_lab_exec;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sql_lab_exec;

-- Tabelas criadas depois também entram na concessão.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sql_lab_exec;

-- E nada além de leitura: a revogação é explícita, para ficar claro que a
-- ausência de privilégio é intencional e não um esquecimento.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM sql_lab_exec;

-- Sem DDL: o papel de execução não cria nem derruba nada.
REVOKE CREATE ON SCHEMA public FROM sql_lab_exec;
