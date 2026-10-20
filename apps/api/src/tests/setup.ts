/**
 * Preparação do ambiente de teste.
 *
 * Este arquivo roda ANTES de qualquer módulo da aplicação ser importado. Por
 * isso ele não importa nada do projeto: o único trabalho dele é apontar a
 * aplicação para o banco de teste.
 *
 * Sem essa redireção, a suíte exercita o banco de desenvolvimento — que é um
 * erro de verdade, não um detalhe de CI: a suíte passaria numa máquina onde
 * o banco de teste está vazio, e falharia por motivo errado.
 *
 * As duas conexões são redirecionadas: a de consulta e a administrativa. Se
 * só a primeira fosse trocada, a gravação do progresso — que usa a conexão
 * administrativa — continuaria indo para o banco de desenvolvimento.
 */
if (process.env.TEST_DATABASE_URL && !process.env.SQL_LAB_TESTE_PREPARADO) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (process.env.TEST_DATABASE_ADMIN_URL && !process.env.SQL_LAB_TESTE_PREPARADO) {
  process.env.DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
}

/**
 * Origens liberadas no CORS, fixas para a suíte.
 *
 * A interface de produção e a de desenvolvimento ficam em domínios
 * diferentes, e a API precisa liberar as duas. A suíte fixa uma lista com
 * duas entradas para conferir o comportamento do CORS de forma determinística.
 */
process.env.ALLOWED_ORIGIN = 'http://localhost:5173,https://sql-lab.pages.dev';
