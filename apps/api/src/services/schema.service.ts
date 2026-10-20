import { withReadOnlyClient } from '../database/pool.js';

export type ColunaDoEsquema = {
  nome: string;
  tipo: string;
  nulo: boolean;
  padrao: string | null;
};

export type TabelaDoEsquema = {
  nome: string;
  colunas: ColunaDoEsquema[];
  linhas: number;
  chavePrimaria: string[];
  relacionamentos: { coluna: string; referencia: string }[];
};

/**
 * Descreve o esquema do ERP, direto do banco.
 *
 * Serve para o aluno saber o que existe antes de escrever a consulta: quais
 * tabelas, quais colunas, quantas linhas cada uma tem e como as chaves
 * estrangeiras se relacionam.
 *
 * A informação vem do catálogo do PostgreSQL (`information_schema` e
 * `pg_catalog`), não de uma lista escrita à mão: o que aparece é o que
 * existe no banco.
 */
export async function descreverEsquema(): Promise<TabelaDoEsquema[]> {
  return withReadOnlyClient(async (client) => {
    const { rows: tabelas } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const resultado: TabelaDoEsquema[] = [];

    for (const { table_name: tabela } of tabelas) {
      const { rows: colunas } = await client.query(
        `
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position
        `,
        [tabela],
      );

      const { rows: chaves } = await client.query(
        `
          SELECT a.attname AS coluna
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary
        `,
        [`public.${tabela}`],
      );

      const { rows: relacionamentos } = await client.query(
        `
          SELECT tc.constraint_name,
                 kcu.column_name,
                 ccu.table_name AS tabela_referenciada,
                 ccu.column_name AS coluna_referenciada
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = $1
        `,
        [tabela],
      );

      // A contagem de linhas é aproximada em tabelas grandes; aqui todas são
      // pequenas, então a contagem exata ajuda mais do que atrapalha.
      const { rows: contagem } = await client.query(
        `SELECT count(*)::int AS total FROM "${tabela}"`,
      );

      resultado.push({
        nome: tabela,
        colunas: colunas.map((coluna) => ({
          nome: coluna.column_name,
          tipo: coluna.data_type,
          nulo: coluna.is_nullable === 'YES',
          padrao: coluna.column_default,
        })),
        linhas: contagem[0]?.total ?? 0,
        chavePrimaria: chaves.map((chave) => chave.coluna),
        relacionamentos: relacionamentos.map((rel) => ({
          coluna: rel.column_name,
          referencia: `${rel.tabela_referenciada}.${rel.coluna_referenciada}`,
        })),
      });
    }

    return resultado;
  });
}
