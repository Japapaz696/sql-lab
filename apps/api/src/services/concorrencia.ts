import { env } from '../config/env.js';

/**
 * A fila de consultas passou do tempo de espera.
 *
 * O erro é traduzido pelo tratador da API em `503 Service Unavailable` com
 * `Retry-After`, que é o que um cliente bem comportado entende: não é um bug,
 * é sobrecarga temporária.
 */
export class ErroDeSobrecarga extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Muitas consultas ao mesmo tempo.');
    this.name = 'ErroDeSobrecarga';
  }
}

type Espera = {
  resolver: () => void;
  rejeitar: (erro: ErroDeSobrecarga) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Semáforo com fila e tempo máximo de espera.
 *
 * Existe porque o pool do PostgreSQL é finito: se dez requisições pedirem
 * conexão ao mesmo tempo, as últimas ficam esperando o `connectionTimeout` do
 * driver e recebem um erro genérico. Com o semáforo, a aplicação controla a
 * própria fila e responde com uma mensagem clara antes de o pool esgotar.
 *
 * A vaga é transferida direto para o próximo da fila (`liberar` não zera o
 * contador quando há alguém esperando), então não existe janela em que uma
 * vaga fique livre sem ser usada.
 */
export class Semaforo {
  private ativos = 0;
  private readonly fila: Espera[] = [];

  constructor(
    private readonly limite: number,
    private readonly esperaMaximaMs: number,
  ) {
    if (limite < 1) throw new Error('O limite do semáforo deve ser pelo menos 1.');
    if (esperaMaximaMs < 1) throw new Error('O tempo de espera deve ser pelo menos 1 ms.');
  }

  /** Quantas operações estão em andamento agora. */
  get emUso(): number {
    return this.ativos;
  }

  /** Quantas operações aguardam uma vaga. */
  get naFila(): number {
    return this.fila.length;
  }

  /**
   * Executa a operação quando houver vaga. Se a fila não andar dentro do
   * tempo máximo, rejeita com `ErroDeSobrecarga` — e a operação **não** roda.
   */
  async executar<T>(operacao: () => Promise<T>): Promise<T> {
    await this.adquirir();
    try {
      return await operacao();
    } finally {
      this.liberar();
    }
  }

  private adquirir(): Promise<void> {
    if (this.ativos < this.limite) {
      this.ativos += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolver, rejeitar) => {
      const espera: Espera = {
        resolver,
        rejeitar,
        timer: setTimeout(() => {
          const posicao = this.fila.indexOf(espera);
          if (posicao >= 0) this.fila.splice(posicao, 1);
          rejeitar(new ErroDeSobrecarga(Math.ceil(this.esperaMaximaMs / 1000)));
        }, this.esperaMaximaMs),
      };
      this.fila.push(espera);
    });
  }

  private liberar(): void {
    const proximo = this.fila.shift();
    if (proximo) {
      clearTimeout(proximo.timer);
      // A vaga passa direto para quem esperava: `ativos` continua o mesmo.
      proximo.resolver();
      return;
    }
    this.ativos -= 1;
  }
}

/**
 * Fila única para as consultas do aluno e para o EXPLAIN.
 *
 * As duas rotas abrem conexão no mesmo pool de leitura; um limite separado
 * para cada uma deixaria o total chegar ao dobro do pool. Uma fila só mantém
 * a garantia de que nunca há mais consultas abertas do que o configurado.
 */
export const semaforoDeConsultas = new Semaforo(env.maxConcurrentQueries, env.queueWaitMs);
