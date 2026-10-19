import { useEffect, useState } from 'react';
import type { ExplainResponse, ScenarioDetail, ScenarioSummary } from '@sql-lab/shared';

import {
  ErroDeApi,
  buscarSolucao,
  detalharCenario,
  executarCenario,
  explicarCenario,
  listarCenarios,
} from './services/api';

type Aba = 'cenario' | 'explicacao';

const rotulosArea: Record<string, string> = {
  comercial: 'Comercial',
  faturamento: 'Faturamento',
  estoque: 'Estoque',
  cadastro: 'Cadastro',
  relatorio: 'Relatório',
};

const rotulosNivel: Record<string, string> = {
  iniciante: 'Iniciante',
  intermediario: 'Intermediário',
  avancado: 'Avançado',
};

export function App() {
  const [cenarios, setCenarios] = useState<ScenarioSummary[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<ScenarioDetail | null>(null);
  const [sql, setSql] = useState('');
  const [resultado, setResultado] = useState<{
    colunas: string[];
    linhas: (string | number | boolean | null)[][];
    totalLinhas: number;
    truncado: boolean;
    duracaoMs: number;
    erro?: string;
    ok: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ acertou: boolean; texto: string } | null>(null);
  const [plano, setPlano] = useState<ExplainResponse | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>('cenario');
  const [dicaVisivel, setDicaVisivel] = useState(0);

  // Carrega a lista de cenários.
  useEffect(() => {
    let cancelado = false;
    listarCenarios()
      .then((dados) => {
        if (cancelado) return;
        setCenarios(dados.cenarios);
        if (dados.cenarios.length > 0) setSelecionado(dados.cenarios[0]!.id);
      })
      .catch((erroDesconhecido: unknown) => {
        if (cancelado) return;
        setErro(
          erroDesconhecido instanceof ErroDeApi
            ? erroDesconhecido.message
            : 'Não foi possível falar com a API. Ela está rodando?',
        );
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Carrega o detalhe do cenário selecionado.
  useEffect(() => {
    if (!selecionado) return;
    let cancelado = false;
    setDetalhe(null);
    setResultado(null);
    setFeedback(null);
    setPlano(null);
    setDicaVisivel(0);
    setAba('cenario');

    detalharCenario(selecionado)
      .then((dado) => {
        if (cancelado) return;
        setDetalhe(dado);
        setSql(dado.sqlInicial);
      })
      .catch((erroDesconhecido: unknown) => {
        if (cancelado) return;
        setErro(
          erroDesconhecido instanceof ErroDeApi
            ? erroDesconhecido.message
            : 'Não foi possível carregar o cenário.',
        );
      });

    return () => {
      cancelado = true;
    };
  }, [selecionado]);

  async function executar() {
    if (!selecionado) return;
    setErro('');
    setPlano(null);
    try {
      const resposta = await executarCenario(selecionado, sql);
      setResultado(resposta.consulta);
      setFeedback({ acertou: resposta.verificacao.acertou, texto: resposta.verificacao.feedback });
      if (resposta.verificacao.acertou) {
        setCenarios((atuais) =>
          atuais.map((cenario) =>
            cenario.id === selecionado
              ? { ...cenario, resolvido: true, tentativas: resposta.tentativas }
              : cenario,
          ),
        );
      } else {
        setCenarios((atuais) =>
          atuais.map((cenario) =>
            cenario.id === selecionado ? { ...cenario, tentativas: resposta.tentativas } : cenario,
          ),
        );
      }
    } catch (erroDesconhecido: unknown) {
      setErro(
        erroDesconhecido instanceof ErroDeApi
          ? erroDesconhecido.message
          : 'Não foi possível executar a consulta.',
      );
    }
  }

  async function explicar() {
    if (!selecionado) return;
    try {
      setPlano(await explicarCenario(selecionado, sql));
    } catch {
      setPlano({ linhas: [], erro: 'Não foi possível gerar o plano de execução.' });
    }
  }

  async function verSolucao() {
    if (!selecionado) return;
    try {
      const solucao = await buscarSolucao(selecionado);
      setSql(solucao.sqlReferencia);
      setAba('cenario');
    } catch {
      setErro('Não foi possível carregar a solução de referência.');
    }
  }

  const resolvidosAgora = cenarios.filter((cenario) => cenario.resolvido).length;

  return (
    <div className="app">
      <header className="cabecalho">
        <div className="shell">
          <p className="marca">SQL LAB</p>
          <h1>Diagnóstico e suporte a ERP, com SQL de verdade.</h1>
          <p className="subtitulo">
            Dez cenários de suporte com um banco PostgreSQL de vendas e distribuição: clientes,
            pedidos, produtos, pagamentos, estoque e chamados. Você escreve a consulta, ela roda, e
            o laboratório diz se o diagnóstico está certo.
          </p>
          <dl className="numeros">
            <div>
              <dt>Cenários</dt>
              <dd>{cenarios.length || '—'}</dd>
            </div>
            <div>
              <dt>Resolvidos</dt>
              <dd>
                {resolvidosAgora}
                <span className="de"> / {cenarios.length || '—'}</span>
              </dd>
            </div>
            <div>
              <dt>Banco</dt>
              <dd>PostgreSQL 16</dd>
            </div>
            <div>
              <dt>Dados</dt>
              <dd>Fictícios</dd>
            </div>
          </dl>
        </div>
      </header>

      {erro ? (
        <p className="alerta" role="alert">
          {erro}
        </p>
      ) : null}

      <main className="shell layout">
        <nav className="lista-cenarios" aria-label="Cenários do laboratório">
          <h2 className="titulo-secao">Cenários</h2>
          {carregando ? <p className="suave">Carregando…</p> : null}
          <ol>
            {cenarios.map((cenario) => (
              <li key={cenario.id}>
                <button
                  type="button"
                  className={cenario.id === selecionado ? 'cartao-cenario ativo' : 'cartao-cenario'}
                  onClick={() => setSelecionado(cenario.id)}
                  aria-current={cenario.id === selecionado ? 'true' : undefined}
                >
                  <span className="cenario-topo">
                    <span className="area">{rotulosArea[cenario.area] ?? cenario.area}</span>
                    {cenario.resolvido ? (
                      <span className="marca-ok" aria-label="Resolvido">
                        ✓
                      </span>
                    ) : null}
                  </span>
                  <span className="cenario-titulo">{cenario.titulo}</span>
                  <span className="cenario-tecnica">{cenario.tecnica}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="workspace" aria-label="Cenário selecionado">
          {!detalhe ? (
            <p className="suave">Escolha um cenário para começar.</p>
          ) : (
            <>
              <div className="cabecalho-cenario">
                <p className="area">
                  {rotulosArea[detalhe.area]} · {rotulosNivel[detalhe.nivel] ?? detalhe.nivel}
                </p>
                <h2>{detalhe.titulo}</h2>
                <p className="sintoma">
                  <strong>Sintoma.</strong> {detalhe.sintoma}
                </p>
                <p className="contexto">{detalhe.contexto}</p>
              </div>

              <div className="abas" role="tablist" aria-label="Seções do cenário">
                <button
                  type="button"
                  role="tab"
                  aria-selected={aba === 'cenario'}
                  className={aba === 'cenario' ? 'aba ativa' : 'aba'}
                  onClick={() => setAba('cenario')}
                >
                  Resolver
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={aba === 'explicacao'}
                  className={aba === 'explicacao' ? 'aba ativa' : 'aba'}
                  onClick={() => setAba('explicacao')}
                >
                  Entender
                </button>
              </div>

              {aba === 'cenario' ? (
                <>
                  <div className="editor">
                    <label htmlFor="sql" className="rotulo-editor">
                      Consulta SQL
                    </label>
                    <textarea
                      id="sql"
                      value={sql}
                      onChange={(evento) => setSql(evento.target.value)}
                      spellCheck={false}
                      rows={12}
                      aria-describedby="ajuda-editor"
                    />
                    <p id="ajuda-editor" className="suave">
                      A consulta roda em uma transação somente leitura. Você pode editar livremente.
                    </p>
                    <div className="acoes">
                      <button type="button" className="primario" onClick={() => void executar()}>
                        Executar
                      </button>
                      <button type="button" onClick={() => void explicar()}>
                        Ver plano de execução
                      </button>
                      <button type="button" className="discreto" onClick={() => void verSolucao()}>
                        Mostrar solução
                      </button>
                    </div>
                  </div>

                  {feedback ? (
                    <p className={feedback.acertou ? 'retorno ok' : 'retorno ruim'} role="status">
                      {feedback.acertou ? '✓ ' : '→ '}
                      {feedback.texto}
                    </p>
                  ) : null}

                  {resultado?.erro ? (
                    <p className="retorno ruim" role="alert">
                      {resultado.erro}
                    </p>
                  ) : null}

                  {resultado && resultado.ok ? (
                    <div className="resultado">
                      <p className="suave">
                        {resultado.totalLinhas} linha(s) em {resultado.duracaoMs} ms
                        {resultado.truncado ? ' · resultado truncado' : ''}
                      </p>
                      <div className="tabela-scroll">
                        <table>
                          <thead>
                            <tr>
                              {resultado.colunas.map((coluna) => (
                                <th key={coluna} scope="col">
                                  {coluna}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resultado.linhas.map((linha, indice) => (
                              <tr key={indice}>
                                {linha.map((celula, indiceCelula) => (
                                  <td key={indiceCelula}>
                                    {celula === null ? '—' : String(celula)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {plano ? (
                    <div className="plano">
                      <h3>Plano de execução</h3>
                      {plano.erro ? <p className="retorno ruim">{plano.erro}</p> : null}
                      {plano.linhas.length > 0 ? (
                        <pre>
                          {plano.linhas
                            .map((linha) => `${linha.chave}  ${linha.detalhe}`)
                            .join('\n')}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="ajuda">
                    <h3>Precisa de uma pista?</h3>
                    {detalhe.dicas.slice(0, dicaVisivel).map((dica, indice) => (
                      <p key={indice} className="dica">
                        {indice + 1}. {dica}
                      </p>
                    ))}
                    {dicaVisivel < detalhe.dicas.length ? (
                      <button
                        type="button"
                        className="discreto"
                        onClick={() => setDicaVisivel((n) => n + 1)}
                      >
                        Revelar mais uma dica ({dicaVisivel + 1} de {detalhe.dicas.length})
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="explicacao">
                  <h3>Por que essa consulta funciona</h3>
                  <p>{detalhe.explicacao}</p>

                  <h3>Índices em jogo</h3>
                  <ul className="lista-indices">
                    {detalhe.indices.map((indice) => (
                      <li key={indice}>
                        <code>{indice}</code>
                      </li>
                    ))}
                  </ul>

                  <h3>Erros comuns</h3>
                  <ul>
                    {detalhe.errosComuns.map((erroComum) => (
                      <li key={erroComum}>{erroComum}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="rodape">
        <div className="shell">
          <p>
            Laboratório de SQL para diagnóstico e suporte a ERP. Todos os dados são fictícios:
            e-mails no domínio reservado <code>exemplo.invalid</code> e documentos com sequências
            claramente inventadas.
          </p>
          <p className="suave">
            O conteúdo do banco é de um ERP de vendas e distribuição: cliente, pedido, produto,
            pagamento, estoque e chamado.
          </p>
        </div>
      </footer>
    </div>
  );
}
