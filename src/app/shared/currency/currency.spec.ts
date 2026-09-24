import { formatCOP, parseCOPDigits } from './currency';

describe('formatCOP', () => {
  it('formats with thousands separator, no decimals, and the "$" symbol (never the "COP" code)', () => {
    const result = formatCOP(150000);
    expect(result).toContain('$');
    expect(result).not.toContain('COP');
    expect(result.replace(/[^\d.]/g, '')).toBe('150.000');
  });

  it('formats zero', () => {
    expect(formatCOP(0)).toContain('0');
  });

  it('treats null/undefined/NaN as zero instead of throwing or printing "NaN"', () => {
    expect(formatCOP(null)).toBe(formatCOP(0));
    expect(formatCOP(undefined)).toBe(formatCOP(0));
    expect(formatCOP(NaN)).toBe(formatCOP(0));
  });

  it('with showSign: shows a leading "+" for a positive amount', () => {
    expect(formatCOP(50000, true)).toMatch(/^\+/);
  });

  it('with showSign: shows a leading "-" for a negative amount', () => {
    expect(formatCOP(-50000, true)).toMatch(/^-/);
  });

  it('with showSign: shows no sign for zero', () => {
    expect(formatCOP(0, true)).not.toMatch(/^[+-]/);
  });

  it('without showSign (default): never shows a leading "+" even for a positive amount', () => {
    expect(formatCOP(50000)).not.toMatch(/^\+/);
  });
});

describe('parseCOPDigits', () => {
  it('strips the currency symbol, spaces and thousands separators', () => {
    expect(parseCOPDigits('$ 150.000')).toBe(150000);
  });

  it('returns 0 for empty or non-numeric text', () => {
    expect(parseCOPDigits('')).toBe(0);
    expect(parseCOPDigits('$ ')).toBe(0);
  });

  it('keeps only digits when the sign/decimal separators are mixed in', () => {
    expect(parseCOPDigits('-$1,234.56')).toBe(123456);
  });
});
