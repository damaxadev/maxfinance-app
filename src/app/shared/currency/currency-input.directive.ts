import { Directive, ElementRef, Renderer2, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { formatCOP, parseCOPDigits } from './currency';

/**
 * Directiva para campos de monto (ver DESIGN.md, "Formato de moneda"): el
 * input muestra el valor formateado ("$ 150.000") mientras el usuario
 * escribe, pero el FormControl subyacente sigue guardando el número plano
 * (150000) — así ninguna validación existente (Validators.min, required,
 * etc.) se entera de que hay una máscara de por medio.
 *
 * Toma control total del <input> como ControlValueAccessor (en vez de
 * combinarse con NumberValueAccessor) porque necesita mostrar TEXTO
 * formateado, algo que un <input type="number"> nativo no permite (rechaza
 * separadores de miles) — por eso fuerza type="text" + inputmode="decimal"
 * al iniciar, sin necesidad de tocar esos atributos en cada template.
 */
@Directive({
  selector: 'input[mfxCurrencyInput]',
  host: {
    '(input)': 'onInput($event)',
    '(blur)': 'onBlur()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MfxCurrencyInputDirective),
      multi: true,
    },
  ],
})
export class MfxCurrencyInputDirective implements ControlValueAccessor {
  private readonly elementRef = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  private onChange: (value: number) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    this.renderer.setProperty(this.elementRef.nativeElement, 'type', 'text');
    this.renderer.setAttribute(this.elementRef.nativeElement, 'inputmode', 'decimal');
  }

  writeValue(value: number | null): void {
    this.renderer.setProperty(this.elementRef.nativeElement, 'value', formatCOP(value));
  }

  registerOnChange(fn: (value: number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.renderer.setProperty(this.elementRef.nativeElement, 'disabled', isDisabled);
  }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const numericValue = parseCOPDigits(input.value);

    this.renderer.setProperty(input, 'value', formatCOP(numericValue));
    this.onChange(numericValue);
  }

  onBlur(): void {
    this.onTouched();
  }
}
