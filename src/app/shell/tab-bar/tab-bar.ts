import { Component, input, output } from '@angular/core';

export interface TabBarItem {
  label: string;
}

export const SHELL_TABS: readonly TabBarItem[] = [
  { label: 'Inicio' },
  { label: 'Movimientos' },
  { label: 'Grupos' },
  { label: 'Presupuesto' },
  { label: 'Ajustes' },
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
