// Formato único de moneda para toda la app (ver DESIGN.md, "Formato de
// moneda"): pesos colombianos, separador de miles, sin decimales, símbolo
// "$" — nunca el texto "COP". currencyDisplay: 'symbol' se deja explícito
// a propósito: sin él, algunos entornos (revisado con Node — ver historial)
// pueden preferir el código ISO ("COP") en vez del símbolo para este locale.
const CURRENCY_FORMATTER = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  currencyDisplay: 'symbol',
  maximumFractionDigits: 0,
});

// Misma configuración, pero con signDisplay para mostrar "+"/"-" explícito
// — usado por los montos de movimientos (ingreso vs. gasto), donde el signo
// es la señal visual, no solo un color.
const SIGNED_CURRENCY_FORMATTER = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  currencyDisplay: 'symbol',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});

export function formatCOP(value: number | null | undefined, showSign = false): string {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return (showSign ? SIGNED_CURRENCY_FORMATTER : CURRENCY_FORMATTER).format(safeValue);
}

// Recupera el número plano que el usuario está escribiendo a partir del
// texto ya formateado de un <input> — usado por MfxCurrencyInputDirective.
// Quita todo lo que no sea un dígito (símbolo, espacio, separador de miles).
export function parseCOPDigits(text: string): number {
  const digitsOnly = text.replace(/[^0-9]/g, '');
  return digitsOnly ? Number(digitsOnly) : 0;
}
