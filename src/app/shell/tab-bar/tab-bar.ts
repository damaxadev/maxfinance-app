import { Component, input, output } from '@angular/core';

export interface TabBarItem {
  label: string;
  icon: string;
}

// Presupuesto → Recurrentes (Fase 7, ver DESIGN.md): el tab ahora solo
// contiene pagos recurrentes; presupuestos se configuran desde Ajustes.
// Íconos agregados en la misma ronda — no existían antes (solo texto), un
// set simple y coherente en vez de dejar 4 sin ícono y 1 con.
export const SHELL_TABS: readonly TabBarItem[] = [
  { label: 'Inicio', icon: '🏠' },
  { label: 'Movimientos', icon: '💳' },
  { label: 'Grupos', icon: '👥' },
  { label: 'Recurrentes', icon: '🔁' },
  { label: 'Ajustes', icon: '⚙️' },
];

@Component({
  selector: 'mfx-tab-bar',
  imports: [],
  templateUrl: './tab-bar.html',
  styleUrl: './tab-bar.scss',
})
export class TabBar {
  readonly activeIndex = input(0);
  readonly tabSelected = output<number>();

  readonly tabs = SHELL_TABS;

  selectTab(index: number): void {
    this.tabSelected.emit(index);
  }
}
