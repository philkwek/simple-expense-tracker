import { describe, expect, it } from 'vitest';
import {
  QUICK_PICK_CURRENCY_CODES,
  SUPPORTED_CURRENCIES,
  getCurrencyOption,
  isZeroDecimalCurrency,
  roundToCurrency,
} from './expense';

describe('currency list', () => {
  it('lists the quick picks first, in chip order', () => {
    expect(SUPPORTED_CURRENCIES.slice(0, 5).map((c) => c.code)).toEqual([
      ...QUICK_PICK_CURRENCY_CODES,
    ]);
  });

  it('still supports the codes that existing budgets were saved with', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    for (const code of ['USD', 'EUR', 'GBP', 'SGD', 'CAD', 'AUD', 'JPY']) {
      expect(codes).toContain(code);
    }
  });

  it('uses unique 3-letter codes', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
  });
});

describe('getCurrencyOption', () => {
  it('returns the listed details for a known code', () => {
    expect(getCurrencyOption('TWD')).toEqual({
      code: 'TWD',
      symbol: 'NT$',
      name: 'New Taiwan Dollar',
    });
  });

  it('falls back to the code itself for an unlisted code', () => {
    expect(getCurrencyOption('ZAR')).toEqual({
      code: 'ZAR',
      symbol: 'ZAR',
      name: 'ZAR',
    });
  });
});

describe('zero-decimal currencies', () => {
  it('treats JPY, KRW, VND, TWD and IDR as whole-unit currencies', () => {
    for (const code of ['JPY', 'KRW', 'VND', 'TWD', 'IDR']) {
      expect(isZeroDecimalCurrency(code)).toBe(true);
    }
    for (const code of ['USD', 'SGD', 'MYR', 'CNY']) {
      expect(isZeroDecimalCurrency(code)).toBe(false);
    }
  });

  it('rounds amounts to the currency precision', () => {
    expect(roundToCurrency(12.345, 'SGD')).toBe(12.35);
    expect(roundToCurrency(1250.6, 'KRW')).toBe(1251);
    expect(roundToCurrency(99.4, 'TWD')).toBe(99);
  });
});
