import { describe, expect, it } from 'vitest';

import { validarConsultaSql } from '../services/sql-validation.js';

describe('validador de segurança SQL', () => {
  it('aceita uma consulta SELECT simples', () => {
    expect(validarConsultaSql('SELECT * FROM clientes')).toEqual({ ok: true });
  });

  it('rejeita consulta vazia', () => {
    expect(validarConsultaSql('   ').ok).toBe(false);
  });

  it('rejeita múltiplas instruções', () => {
    expect(validarConsultaSql('SELECT 1; DROP TABLE clientes').ok).toBe(false);
    expect(validarConsultaSql('SELECT 1; DROP TABLE clientes').erro).toMatch(/uma instrução/i);
  });

  it('rejeita comandos de escrita', () => {
    for (const comando of ['UPDATE', 'DELETE', 'DROP', 'INSERT', 'TRUNCATE', 'GRANT']) {
      expect(validarConsultaSql(`${comando} FROM clientes`).ok).toBe(false);
    }
  });

  it('permite palavras reservadas dentro de strings literais', () => {
    expect(validarConsultaSql("SELECT 'drop' AS palavra FROM clientes").ok).toBe(true);
  });
});