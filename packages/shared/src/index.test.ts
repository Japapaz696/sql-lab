import { describe, expect, it } from 'vitest';

import { scenarioAreas, scenarioLevels } from './index.js';

describe('contrato compartilhado', () => {
  it('cobre as seis áreas do ERP', () => {
    expect([...scenarioAreas].sort()).toEqual([
      'cadastro',
      'comercial',
      'estoque',
      'faturamento',
      'logistica',
      'relatorio',
    ]);
  });

  it('cobre os três níveis de dificuldade', () => {
    expect([...scenarioLevels].sort()).toEqual(['avancado', 'iniciante', 'intermediario']);
  });

  it('não repete valores em nenhuma lista', () => {
    for (const lista of [scenarioAreas, scenarioLevels]) {
      expect(new Set(lista).size).toBe(lista.length);
    }
  });
});
