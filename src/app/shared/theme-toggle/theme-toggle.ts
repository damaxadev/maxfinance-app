import { Component, inject } from '@angular/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { ThemeService } from '../../core/theme/theme';

@Component({
  selector: 'mfx-theme-toggle',
  imports: [],
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.scss',
})
export class ThemeToggle {
  private readonly themeService = inject(ThemeService);
  readonly theme = this.themeService.theme;

  async toggle(): Promise<void> {
    await this.themeService.toggle();
    void this.buzz();
  }

  private async buzz(): Promise<void> {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }
}
