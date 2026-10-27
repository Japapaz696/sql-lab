/**
 * Validação prévia do SQL escrito no laboratório.
 *
 * O PostgreSQL e a transação somente leitura são a proteção real. Esta
 * função existe para dar uma resposta rápida e legível antes de abrir uma
 * conexão, e para bloquear padrões óbvios de múltiplas instruções e de
 * comandos de escrita.
 */

const comandosDestrutivos = [
  'insert',
  'update',
  'delete',
  'drop',
  'truncate',
  'create',
  'alter',
  'grant',
  'revoke',
  'vacuum',
  'copy',
  'do',
  'commit',
  'rollback',
  'begin',
  'set',
];

function removerStrings(texto: string): string {
  return texto.replace(/'(?:''|[^'])*'/g, "''");
}

function contarInstrucoes(texto: string): number {
  const semStrings = removerStrings(texto);
  return semStrings
    .split(';')
    .map((parte) => parte.trim())
    .filter(Boolean).length;
}

export function validarConsultaSql(texto: string): { ok: boolean; erro?: string } {
  const consulta = texto.trim();

  if (!consulta) {
    return { ok: false, erro: 'Escreva uma consulta SQL antes de executar.' };
  }

  if (contarInstrucoes(consulta) > 1) {
    return {
      ok: false,
      erro: 'Só é permitida uma instrução por consulta. Rode as consultas uma de cada vez.',
    };
  }

  const semStrings = removerStrings(consulta).toLowerCase();
  const palavras = semStrings.match(/[a-z_]+/g) ?? [];

  if (palavras.some((palavra) => comandosDestrutivos.includes(palavra))) {
    return {
      ok: false,
      erro: 'Esta consulta tentaria escrever ou alterar o banco. O laboratório é de leitura: filtre e consulte, sem alterar dados.',
    };
  }

  return { ok: true };
}