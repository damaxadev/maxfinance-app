import { Pipe, PipeTransform } from '@angular/core';

import { formatCOP } from './currency';

/**
 * Formato de moneda único para toda la app — ver DESIGN.md, "Formato de
 * moneda". Uso: {{ amount | mfxCurrency }} o {{ amount | mfxCurrency:true }}
 * para mostrar el signo (+/-) explícito.
 */
@Pipe({
  name: 'mfxCurrency',
})
export class MfxCurrencyPipe implements PipeTransform {
  transform(value: number | null | undefined, showSign = false): string {
    return formatCOP(value, showSign);
  }
}
