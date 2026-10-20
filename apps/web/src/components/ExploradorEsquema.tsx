import { useState } from 'react';
import type { TabelaDoEsquema } from '../services/api';

type Props = {
  tabelas: TabelaDoEsquema[];
};

/**
 * Explorador do esquema.
 *
 * Mostra o que existe no banco: tabelas, colunas, tipos, chaves primárias e
 * relacionamentos. Vem do catálogo do PostgreSQL, então é o banco real.
 *
 * As tabelas do ERP vêm primeiro, e as de apoio no fim — o aluno começa por
 * onde a consulta costuma começar.
 */
export function ExploradorEsquema({ tabelas }: Props) {
  const [aberta, setAberta] = useState<string | null>(null);

  const centrality = (nome: string) => {
    if (nome === 'clientes' || nome === 'produtos') return 0;
    if (nome === 'pedidos' || nome === 'depositos') return 1;
    if (nome === 'itens_pedido' || nome === 'pagamentos' || nome === 'estoque') return 2;
    return 3;
  };

  const ordenadas = [...tabelas].sort(
    (a, b) => centrality(a.nome) - centrality(b.nome) || a.nome.localeCompare(b.nome),
  );

  return (
    <div className="esquema">
      <h3>Esquema do ERP</h3>
      <p className="suave">
        Lido do catálogo do PostgreSQL. Clique numa tabela para ver as colunas.
      </p>

      <ul className="lista-tabelas">
        {ordenadas.map((tabela) => {
          const expandida = aberta === tabela.nome;
          return (
            <li key={tabela.nome}>
              <button
                type="button"
                className={expandida ? 'tabela do-esquema expandida' : 'tabela do-esquema'}
                onClick={() => setAberta(expandida ? null : tabela.nome)}
                aria-expanded={expandida}
              >
                <span className="nome-tabela">{tabela.nome}</span>
                <span className="contagem-tabela">{tabela.linhas} linha(s)</span>
              </button>

              {expandida ? (
                <div className="detalhe-tabela">
                  <table className="tabela-colunas">
                    <thead>
                      <tr>
                        <th scope="col">Coluna</th>
                        <th scope="col">Tipo</th>
                        <th scope="col">Chave</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabela.colunas.map((coluna) => (
                        <tr key={coluna.nome}>
                          <td>
                            {coluna.nome}
                            {coluna.nulo ? <span className="opcional"> (opcional)</span> : null}
                          </td>
                          <td className="tipo-coluna">{coluna.tipo}</td>
                          <td>
                            {tabela.chavePrimaria.includes(coluna.nome) ? (
                              <span className="etiqueta pk">PK</span>
                            ) : null}
                            {tabela.relacionamentos.some((r) =>
                              r.coluna.startsWith(`${coluna.nome} ->`),
                            ) ? (
                              <span className="etiqueta fk">FK</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {tabela.relacionamentos.length ? (
                    <p className="relacionamentos">
                      <strong>Aponta para:</strong>{' '}
                      {tabela.relacionamentos.map((r) => r.coluna).join(', ')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
