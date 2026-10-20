import { useCallback, useEffect, useState } from 'react';
import type { ExplainResponse, ScenarioDetail, ScenarioSummary } from '@sql-lab/shared';

import { ExploradorEsquema } from './components/ExploradorEsquema';
import {
  ErroDeApi,
  buscarEsquema,
  buscarSolucao,
  detalharCenario,
  executarCenario,
  explicarCenario,
  listarCenarios,
  type TabelaDoEsquema,
} from './services/api';

type Aba = 'cenario' | 'explicacao';

const rotulosArea: Record<string, string> = {
  comercial: 'Comercial',
  faturamento: 'Faturamento',
  estoque: 'Estoque',
  cadastro: 'Cadastro',
  logistica: 'Logística',
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
  const [esquema, setEsquema] = useState<TabelaDoEsquema[]>([]);
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
  const [feedback, setFeedback] = useState<{
    acertou: boolean;
    texto: string;
    linhasEsperadas: number;
    linhasObtidas: number;
  } | null>(null);
  const [plano, setPlano] = useState<ExplainResponse | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [acordando, setAcordando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [aba, setAba] = useState<Aba>('cenario');
  const [dicaVisivel, setDicaVisivel] = useState(0);
  const [esquemaAberto, setEsquemaAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Carrega a lista de cenários e o esquema do banco.
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

    buscarEsquema()
      .then((tabelas) => {
        if (!cancelado) setEsquema(tabelas);
      })
      .catch(() => {
        // O esquema é um recurso de apoio: a falta dele não impede o uso.
      });

    return () => {
      cancelado = true;
    };
  }, []);

  // A API do laboratório fica hospedada no plano gratuito, que hiberna
  // depois de um tempo sem tráfego. A primeira carga depois disso leva
  // cerca de um minuto, e "Carregando…" sozinho não explica a demora —
  // parece que a página quebrou.
  useEffect(() => {
    if (!carregando) {
      setAcordando(false);
      return;
    }
    const temporizador = setTimeout(() => setAcordando(true), 6000);
    return () => clearTimeout(temporizador);
  }, [carregando]);

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

  const executar = useCallback(async () => {
    if (!selecionado || executando) return;
    setErro('');
    setPlano(null);
    setExecutando(true);
    try {
      const resposta = await executarCenario(selecionado, sql);
      setResultado(resposta.consulta);
      setFeedback({
        acertou: resposta.verificacao.acertou,
        texto: resposta.verificacao.feedback,
        linhasEsperadas: resposta.verificacao.linhasEsperadas,
        linhasObtidas: resposta.verificacao.linhasObtidas,
      });
      setCenarios((atuais) =>
        atuais.map((cenario) =>
          cenario.id === selecionado
            ? {
                ...cenario,
                resolvido: cenario.resolvido || resposta.verificacao.acertou,
                tentativas: resposta.tentativas,
              }
            : cenario,
        ),
      );
    } catch (erroDesconhecido: unknown) {
      setErro(
        erroDesconhecido instanceof ErroDeApi
          ? erroDesconhecido.message
          : 'Não foi possível executar a consulta.',
      );
    } finally {
      setExecutando(false);
    }
  }, [executando, selecionado, sql]);

  // Ctrl+Enter (ou Cmd+Enter) executa a consulta.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if ((evento.ctrlKey || evento.metaKey) && evento.key === 'Enter') {
        evento.preventDefault();
        void executar();
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [executar]);

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

  async function copiarSql() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      setErro('O navegador não deixou copiar. Selecione o texto e copie à mão.');
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
          {carregando ? (
            <p className="suave">
              {acordando
                ? 'Acordando a API. Em hospedagem gratuita ela hiberna quando fica sem ' +
                  'tráfego, e a primeira carga leva cerca de um minuto. Isso é normal.'
                : 'Carregando…'}
            </p>
          ) : null}
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
                  {cenario.tentativas > 0 ? (
                    <span className="cenario-tentativas">{cenario.tentativas} tentativa(s)</span>
                  ) : null}
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
                    <div className="editor-topo">
                      <label htmlFor="sql" className="rotulo-editor">
                        Consulta SQL
                      </label>
                      <button
                        type="button"
                        className="discreto pequeno"
                        onClick={() => void copiarSql()}
                      >
                        {copiado ? 'Copiado' : 'Copiar SQL'}
                      </button>
                    </div>
                    <textarea
                      id="sql"
                      value={sql}
                      onChange={(evento) => setSql(evento.target.value)}
                      spellCheck={false}
                      rows={12}
                      aria-describedby="ajuda-editor"
                    />
                    <p id="ajuda-editor" className="suave">
                      A consulta roda em uma transação somente leitura, com tempo limite.{' '}
                      <kbd>Ctrl</kbd> + <kbd>Enter</kbd> executa.
                    </p>
                    <div className="acoes">
                      <button
                        type="button"
                        className="primario"
                        onClick={() => void executar()}
                        disabled={executando}
                      >
                        {executando ? 'Executando…' : 'Executar'}
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
                    <div className={feedback.acertou ? 'retorno ok' : 'retorno ruim'} role="status">
                      <p className="retorno-titulo">
                        {feedback.acertou ? '✓ Diagnóstico correto' : '→ Ainda não é o diagnóstico'}
                      </p>
                      <p>{feedback.texto}</p>
                      {!feedback.acertou ? (
                        <p className="retorno-detalhe">
                          A referência devolve {feedback.linhasEsperadas} linha(s); a sua consulta
                          devolveu {feedback.linhasObtidas}.
                        </p>
                      ) : null}
                    </div>
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
                      </p>
                      {resultado.truncado ? (
                        <p className="aviso-truncamento" role="status">
                          Resultado truncado em 200 linhas. A consulta traz mais dados; use um
                          filtro para ver o resto.
                        </p>
                      ) : null}
                      {resultado.colunas.length ? (
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
                      ) : (
                        <p className="suave">A consulta rodou e não devolveu nenhuma coluna.</p>
                      )}
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

              <div className="rodape-esquema">
                <button
                  type="button"
                  className="discreto"
                  onClick={() => setEsquemaAberto((v) => !v)}
                  aria-expanded={esquemaAberto}
                >
                  {esquemaAberto ? 'Esconder o esquema do ERP' : 'Ver o esquema do ERP'}
                </button>
                {esquemaAberto ? <ExploradorEsquema tabelas={esquema} /> : null}
              </div>
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
            pagamento, estoque e chamado. As consultas rodam em uma transação somente leitura, com o
            usuário do banco restringido a SELECT.
          </p>
        </div>
      </footer>
    </div>
  );
}
