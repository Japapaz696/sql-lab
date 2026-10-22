import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { pool } from '../database/pool.js';
import { registrarProgresso } from '../services/progress.service.js';
import {
  compararUsuarios,
  consultarPrivilegiosDeEscrita,
  usuarioDaUrl,
  verificarSeparacaoDePrivilegios,
} from '../services/privilegios.service.js';
import { executarConsulta } from '../services/sql.service.js';
import { abrirBancoAdministrativo } from './banco.js';

/**
 * A separação de privilégios é a terceira camada de proteção do laboratório.
 * Aqui ela é conferida de duas maneiras: pelo catálogo do PostgreSQL e pelo
 * comportamento real do banco.
 */
describe('separação de privilégios', () => {
  let admin: pg.Pool;

  beforeAll(async () => {
    admin = abrirBancoAdministrativo();
  });

  afterAll(async () => {
    await admin?.end();
  });

  describe('comparação dos usuários', () => {
    it('lê o usuário de uma URL de conexão', () => {
      // As URLs de exemplo não têm senha: o CI varre o repositório atrás de
      // string de conexão com senha, e um exemplo com senha seria um falso
      // positivo — ou, pior, um lugar onde alguém deixaria um segredo.
      const simples = 'postgresql://fulano@host:5432/banco';
      const comArroba = 'postgresql://fulano%40x@host:5432/banco';

      expect(usuarioDaUrl(simples)).toBe('fulano');
      expect(usuarioDaUrl(comArroba)).toBe('fulano@x');
      expect(usuarioDaUrl('não é uma url')).toBeNull();
    });

    it('recusa quando as duas conexões usam o mesmo usuário', () => {
      const resultado = compararUsuarios(
        'postgresql://mesmo@host:5432/banco',
        'postgresql://mesmo@outro-host:5432/banco',
      );

      expect(resultado.diferentes).toBe(false);
      expect(resultado.detalhe).toMatch(/mesmo usuário/);
    });

    it('recusa quando não há conexão administrativa', () => {
      const resultado = compararUsuarios('postgresql://alguem@host:5432/banco', undefined);

      expect(resultado.diferentes).toBe(false);
      expect(resultado.detalhe).toMatch(/DATABASE_ADMIN_URL/);
    });

    it('aceita quando os usuários são diferentes', () => {
      const resultado = compararUsuarios(
        'postgresql://execucao@host:5432/banco',
        'postgresql://admin@host:5432/banco',
      );

      expect(resultado.diferentes).toBe(true);
    });
  });

  describe('o que o banco permite', () => {
    it('o usuário de execução não tem permissão de escrita', async () => {
      const client = await pool.connect();
      try {
        const resultado = await consultarPrivilegiosDeEscrita(client);

        expect(resultado.podeEscrever).toBe(false);
        expect(resultado.detalhe).toMatch(/sem escrita/);
      } finally {
        client.release();
      }
    });

    it('o usuário administrativo tem permissão de escrita', async () => {
      const client = await admin.connect();
      try {
        const resultado = await consultarPrivilegiosDeEscrita(client);

        // Confere que o teste acima não é vazio: o administrador consegue
        // escrever, o usuário de execução não.
        expect(resultado.podeEscrever).toBe(true);
      } finally {
        client.release();
      }
    });

    it('a escrita é recusada fora de transação somente leitura', async () => {
      // Uma conexão crua, sem a opção `default_transaction_read_only`, para
      // que o banco recuse pelo **privilégio**, e não pela transação. É a
      // terceira camada funcionando sozinha.
      const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      await client.connect();
      try {
        await expect(
          client.query("UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'"),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.end();
      }
    });

    it('a verificação de partida passa com a separação no lugar', async () => {
      const resultado = await verificarSeparacaoDePrivilegios();

      expect(resultado.problemas).toEqual([]);
      expect(resultado.ok).toBe(true);
    });
  });

  describe('a tabela interna de progresso', () => {
    it('não é legível pelo papel de execução', async () => {
      const { rows } = await admin.query(
        `SELECT has_table_privilege('sql_lab_exec', 'public.progresso_cenarios', 'SELECT') AS pode_ler`,
      );

      expect(rows[0].pode_ler).toBe(false);
    });

    it('a consulta do aluno é recusada, com mensagem didática', async () => {
      const resultado = await executarConsulta('SELECT * FROM progresso_cenarios');

      expect(resultado.ok).toBe(false);
      expect(resultado.erro).toMatch(/interno do laboratório/i);
    });

    it('as nove tabelas do ERP continuam legíveis', async () => {
      const { rows } = await admin.query(
        `SELECT tablename,
                has_table_privilege('sql_lab_exec', format('public.%I', tablename), 'SELECT')
                  AS pode_ler
         FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> 'progresso_cenarios'
         ORDER BY tablename`,
      );

      expect(rows).toHaveLength(9);
      expect(rows.every((linha: { pode_ler: boolean }) => linha.pode_ler)).toBe(true);
    });

    it('tabelas criadas depois não ganham SELECT por padrão', async () => {
      await admin.query('CREATE TABLE tabela_criada_depois (id int)');
      try {
        const { rows } = await admin.query(
          `SELECT has_table_privilege('sql_lab_exec', 'public.tabela_criada_depois', 'SELECT')
                    AS pode_ler`,
        );

        expect(rows[0].pode_ler).toBe(false);
      } finally {
        await admin.query('DROP TABLE tabela_criada_depois');
      }
    });
  });

  describe('isolamento da conexão administrativa', () => {
    it('a consulta do aluno não depende da conexão administrativa', async () => {
      // Uma conexão administrativa que não funciona: se o SQL do aluno
      // passasse por ela, a consulta falharia junto.
      const adminQuebrado = new pg.Pool({
        connectionString: 'postgresql://invalido:invalido@127.0.0.1:1/inexistente',
        max: 1,
        connectionTimeoutMillis: 2_000,
      });

      try {
        const progresso = await registrarProgresso(
          'sessao-de-teste',
          'cenario-de-teste',
          true,
          adminQuebrado,
        );

        // A gravação falha, mas o laboratório continua: a falha é do
        // histórico, não da experiência de quem está aprendendo.
        expect(progresso.tentativas).toBe(1);
        expect(progresso.resolvido).toBe(true);

        const resultado = await executarConsulta('SELECT 1 AS n');
        expect(resultado.ok).toBe(true);
        expect(resultado.linhas).toEqual([[1]]);
      } finally {
        await adminQuebrado.end();
      }
    });
  });
});
