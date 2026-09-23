import { Component } from '@angular/core';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';

@Component({
  selector: 'mfx-home',
  imports: [Card, AnimatedNumber, ProgressRing],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  // Datos de ejemplo — el contenido real llega en fases posteriores.
  readonly balance = 1284500;
  readonly budgetUsedPercent = 62;
}
