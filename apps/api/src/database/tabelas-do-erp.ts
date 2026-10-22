/**
 * Tabelas que fazem parte do ERP e podem ser vistas e consultadas.
 *
 * A lista é explícita de propósito. O banco também guarda tabelas internas do
 * laboratório — `progresso_cenarios` — que não são conteúdo didático e não
 * devem aparecer no esquema nem ser legíveis pelo papel de execução.
 *
 * `db/privilegios.sql` repete a mesma lista em SQL: é ele que concede SELECT
 * ao papel `sql_lab_exec`. Ao acrescentar uma tabela ao ERP, atualize os dois
 * lugares (e o teste que confere a lista).
 */
export const TABELAS_DO_ERP = [
  'chamados',
  'clientes',
  'depositos',
  'estoque',
  'itens_pedido',
  'movimentacoes_estoque',
  'pagamentos',
  'pedidos',
  'produtos',
] as const;
