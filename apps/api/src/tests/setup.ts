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
 */
if (process.env.TEST_DATABASE_URL && !process.env.SQL_LAB_TESTE_PREPARADO) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
