import { MfxCurrencyPipe } from './currency.pipe';

describe('MfxCurrencyPipe', () => {
  let pipe: MfxCurrencyPipe;

  beforeEach(() => {
    pipe = new MfxCurrencyPipe();
  });

  it('formats a plain amount without a sign by default', () => {
    expect(pipe.transform(150000)).toBe('$ 150.000');
  });

  it('formats with an explicit sign when asked', () => {
    expect(pipe.transform(150000, true)).toBe('+$ 150.000');
  });

  it('treats null/undefined as zero', () => {
    expect(pipe.transform(null)).toBe('$ 0');
    expect(pipe.transform(undefined)).toBe('$ 0');
  });
});
