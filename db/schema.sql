-- =============================================================
-- SQL Lab — esquema de um ERP de vendas e distribuição
-- =============================================================
--
-- O modelo reflete o que aparece no dia a dia do suporte: cliente,
-- pedido, produto, pagamento, estoque e chamado. Todas as tabelas
-- têm as constraints que um ERP de verdade teria, para que as
-- consultas do laboratório aprendidas aqui façam sentido no banco real.
--
-- Os dados são SEMPRE fictícios (ver `seed.sql`).

-- ---------- cadastros ----------

CREATE TABLE clientes (
  id              UUID PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nome            TEXT NOT NULL,
  documento       TEXT NOT NULL UNIQUE,
  email           TEXT,
  telefone        TEXT,
  cidade          TEXT NOT NULL,
  uf              CHAR(2) NOT NULL,
  canal           TEXT NOT NULL CHECK (canal IN ('varejo', 'atacado', 'distribuidor')),
  limite_credito  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE produtos (
  id              UUID PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nome            TEXT NOT NULL,
  categoria       TEXT NOT NULL,
  preco_unitario  NUMERIC(14, 2) NOT NULL CHECK (preco_unitario > 0),
  custo_unitario  NUMERIC(14, 2) NOT NULL CHECK (custo_unitario >= 0),
  ativo           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE depositos (
  id          UUID PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE,
  nome        TEXT NOT NULL,
  cidade      TEXT NOT NULL,
  uf          CHAR(2) NOT NULL
);

-- ---------- vendas ----------

CREATE TABLE pedidos (
  id            UUID PRIMARY KEY,
  numero        TEXT NOT NULL UNIQUE,
  cliente_id    UUID NOT NULL REFERENCES clientes (id) ON UPDATE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('aberto', 'enviado', 'entregue', 'cancelado')),
  canal         TEXT NOT NULL CHECK (canal IN ('varejo', 'atacado', 'distribuidor')),
  total         NUMERIC(14, 2) NOT NULL CHECK (total >= 0),
  desconto      NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  emitido_em    TIMESTAMPTZ NOT NULL,
  entregue_em   TIMESTAMPTZ
);

CREATE TABLE itens_pedido (
  id                UUID PRIMARY KEY,
  pedido_id         UUID NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  produto_id        UUID NOT NULL REFERENCES produtos (id),
  quantidade        NUMERIC(14, 3) NOT NULL CHECK (quantidade > 0),
  preco_unitario    NUMERIC(14, 2) NOT NULL CHECK (preco_unitario >= 0),
  desconto_item     NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (desconto_item >= 0)
);

-- ---------- financeiro ----------

CREATE TABLE pagamentos (
  id            UUID PRIMARY KEY,
  pedido_id     UUID NOT NULL REFERENCES pedidos (id) ON UPDATE CASCADE,
  meio          TEXT NOT NULL CHECK (meio IN ('pix', 'boleto', 'cartao', 'transferencia')),
  valor         NUMERIC(14, 2) NOT NULL CHECK (valor > 0),
  situacao      TEXT NOT NULL CHECK (situacao IN ('pendente', 'pago', 'vencido', 'estornado')),
  vencimento    DATE NOT NULL,
  pago_em       TIMESTAMPTZ,
  numero_titulo TEXT
);

-- ---------- estoque ----------

CREATE TABLE estoque (
  produto_id   UUID NOT NULL REFERENCES produtos (id) ON UPDATE CASCADE,
  deposito_id  UUID NOT NULL REFERENCES depositos (id) ON UPDATE CASCADE,
  quantidade   NUMERIC(14, 3) NOT NULL CHECK (quantidade >= 0),
  reservado   NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (reservado >= 0),
  PRIMARY KEY (produto_id, deposito_id)
);

CREATE TABLE movimentacoes_estoque (
  id            UUID PRIMARY KEY,
  produto_id    UUID NOT NULL REFERENCES produtos (id),
  deposito_id   UUID NOT NULL REFERENCES depositos (id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'reserva', 'liberacao', 'ajuste')),
  quantidade    NUMERIC(14, 3) NOT NULL CHECK (quantidade <> 0),
  pedido_id     UUID REFERENCES pedidos (id) ON UPDATE CASCADE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- atendimento ----------

CREATE TABLE chamados (
  id            UUID PRIMARY KEY,
  numero        TEXT NOT NULL UNIQUE,
  cliente_id    UUID REFERENCES clientes (id) ON UPDATE CASCADE,
  pedido_id     UUID REFERENCES pedidos (id) ON UPDATE CASCADE,
  categoria     TEXT NOT NULL CHECK (categoria IN ('faturamento', 'estoque', 'cadastro', 'logistica', 'tecnico')),
  prioridade    TEXT NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta')),
  titulo        TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('aberto', 'em_andamento', 'aguardando_cliente', 'resolvido', 'cancelado')),
  aberto_em     TIMESTAMPTZ NOT NULL,
  resolvido_em  TIMESTAMPTZ
);

-- ---------- progresso do aluno no laboratório ----------

-- Uma linha por sessão de navegador. Não guarda nome, e-mail nem
-- documento: só o identificador aleatório da sessão e o cenário.
CREATE TABLE progresso_cenarios (
  sessao_id     TEXT NOT NULL,
  cenario_id    TEXT NOT NULL,
  tentativas    INTEGER NOT NULL DEFAULT 0,
  resolvido_em  TIMESTAMPTZ,
  PRIMARY KEY (sessao_id, cenario_id)
);

-- =============================================================
-- Índices
-- =============================================================
-- Os índices não são decoração: cada cenário do laboratório aponta
-- para o índice que a consulta usa. Sem eles, as consultas de
-- relatório em cima de pedidos e pagamentos ficariam lentas demais
-- para um ERP de verdade.

CREATE INDEX idx_pedidos_cliente      ON pedidos (cliente_id);
CREATE INDEX idx_pedidos_emitido      ON pedidos (emitido_em);
CREATE INDEX idx_pedidos_status       ON pedidos (status);
CREATE INDEX idx_itens_pedido         ON itens_pedido (pedido_id);
CREATE INDEX idx_itens_produto        ON itens_pedido (produto_id);
CREATE INDEX idx_pagamentos_pedido     ON pagamentos (pedido_id);
CREATE INDEX idx_pagamentos_situacao   ON pagamentos (situacao);
CREATE INDEX idx_pagamentos_vencimento ON pagamentos (vencimento);
CREATE INDEX idx_pagamentos_titulo     ON pagamentos (numero_titulo);
CREATE INDEX idx_estoque_produto      ON estoque (produto_id);
CREATE INDEX idx_movimentacoes_produto ON movimentacoes_estoque (produto_id, criado_em);
CREATE INDEX idx_chamados_cliente     ON chamados (cliente_id);
CREATE INDEX idx_chamados_pedido      ON chamados (pedido_id);
CREATE INDEX idx_chamados_status      ON chamados (status);
CREATE INDEX idx_clientes_canal       ON clientes (canal);
