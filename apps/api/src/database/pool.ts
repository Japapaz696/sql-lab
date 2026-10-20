import pg from 'pg';
import Cursor from 'pg-cursor';

import { env } from '../config/env.js';

const { Pool } = pg;

/**
 * Tempo limite para abrir uma conexão.
 *
 * Num banco que hiberna (o Neon do plano gratuito reduz a zero depois de
 * alguns minutos sem tráfego), a primeira conexão demora um pouco mais. Com
 * 10 segundos, a API responderia "não consegui falar com o banco" logo depois
 * de acordar. Trinta segundos cobrem a partida a frio.
 */
const TEMPO_DE_CONEXAO_MS = 30_000;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  // O plano gratuito do Neon reserva poucas conexões: o pool é pequeno de
  // propósito, para não ocupar o limite do projeto.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: TEMPO_DE_CONEXAO_MS,
  // Rede de segurança no nível da conexão: mesmo que alguém abra uma
  // transação de escrita à mão, o banco recusa.
  options: '-c default_transaction_read_only=on -c statement_timeout=10000',
});

pool.on('error', (erro) => {
  console.error('Erro de conexão com o banco:', erro.message);
});

/**
 * Conexão da aplicação: usa o usuário dono do esquema.
 *
 * Serve para o que a **aplicação** precisa gravar — o progresso do aluno — e
 * para preparar o banco. Nunca recebe o SQL de quem usa a interface.
 */
export const poolAdmin = env.databaseAdminUrl
  ? new Pool({
      connectionString: env.databaseAdminUrl,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: TEMPO_DE_CONEXAO_MS,
    })
  : null;

poolAdmin?.on('error', (erro) => {
  console.error('Erro de conexão administrativa:', erro.message);
});

/**
 * Conexão usada para gravar o progresso.
 *
 * Se a conexão administrativa não estiver configurada, cai para a conexão
 * comum — que pode ser somente leitura, e nesse caso o progresso simplesmente
 * não é gravado, em vez de derrubar o laboratório.
 */
export function poolDeEscrita(): pg.Pool {
  return poolAdmin ?? pool;
}

/**
 * Executa uma operação dentro de uma transação somente leitura.
 *
 * A transação garante que nada é escrito. O tempo limite garante que uma
 * consulta pesada não segure a conexão. E o `idle_in_transaction_session_timeout`
 * impede que uma transação fique aberta sem ninguém.
 */
export async function withReadOnlyClient<T>(
  operacao: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${env.queryTimeoutMs}`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${env.queryTimeoutMs}`);
    const resultado = await operacao(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    client.release();
  }
}

/**
 * O cursor do pg-cursor guarda a descricao das colunas em um campo interno,
 * depois da primeira leitura. O tipo publicado nao declara esse campo, entao
 * o acesso passa por uma interface local, explicita sobre o que depende.
 */
type CursorComColunas = {
  _result?: { fields?: { name: string }[] };
};

function colunasDoCursor(cursor: unknown): string[] {
  const interno = cursor as CursorComColunas;
  return (interno._result?.fields ?? []).map((campo) => campo.name);
}

/**
 * Le um conjunto de resultados em lotes, parando no limite.
 *
 * E o que impede que a consulta traga um milhao de linhas para a memoria do
 * processo: o cursor entrega as linhas aos poucos, e a leitura para assim que
 * o limite e atingido. A consulta e abandonada no servidor.
 *
 * O cursor usa o protocolo estendido, que aceita **uma unica instrucao**. E
 * o que impede que quem usa o laboratorio escreva `COMMIT; UPDATE ...` para
 * encerrar a transacao somente leitura e escrever fora dela.
 */
export async function lerComLimite(
  client: pg.PoolClient,
  texto: string,
  limite: number,
): Promise<{ linhas: unknown[][]; colunas: string[]; truncado: boolean }> {
  const cursor = client.query(new Cursor(texto, [], { rowMode: 'array' }));
  const linhas: unknown[][] = [];
  let truncado = false;
  let colunas: string[] = [];

  try {
    for (;;) {
      // Le um lote a mais que o limite: se vier algo, ha mais resultado.
      const lote = await cursor.read(limite + 1);
      if (lote === null || lote.length === 0) break;

      // Depois da primeira leitura, o cursor sabe o nome das colunas.
      if (colunas.length === 0) {
        colunas = colunasDoCursor(cursor);
      }

      if (linhas.length + lote.length > limite) {
        linhas.push(...lote.slice(0, limite - linhas.length));
        truncado = true;
        break;
      }

      linhas.push(...lote);
      if (linhas.length >= limite) {
        // Confere se ainda havia resultado depois do limite.
        const resto = await cursor.read(1);
        truncado = resto !== null && resto.length > 0;
        break;
      }
    }
  } finally {
    await cursor.close().catch(() => undefined);
  }

  return { linhas, colunas, truncado };
}
