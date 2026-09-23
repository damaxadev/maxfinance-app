import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, OnDestroy, AfterViewInit, viewChild, signal } from '@angular/core';
import type { SwiperContainer } from 'swiper/element';

import { TabBar } from './tab-bar/tab-bar';
import { Fab } from '../shared/fab/fab';
import { Home } from './views/home/home';
import { Movements } from './views/movements/movements';
import { Groups } from './views/groups/groups';
import { Budget } from './views/budget/budget';
import { Settings } from './views/settings/settings';

@Component({
  selector: 'mfx-shell',
  imports: [TabBar, Fab, Home, Movements, Groups, Budget, Settings],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class Shell implements AfterViewInit, OnDestroy {
  private readonly swiperEl = viewChild.required<ElementRef<SwiperContainer>>('swiperEl');

  readonly activeIndex = signal(0);

  private readonly handleSlideChange = (): void => {
    const swiper = this.swiperEl().nativeElement.swiper;
    if (swiper) {
      this.activeIndex.set(swiper.activeIndex);
    }
  };

  ngAfterViewInit(): void {
    this.swiperEl().nativeElement.addEventListener('slidechange', this.handleSlideChange);
  }

  ngOnDestroy(): void {
    this.swiperEl().nativeElement.removeEventListener('slidechange', this.handleSlideChange);
  }

  onTabSelected(index: number): void {
    this.activeIndex.set(index);
    this.swiperEl().nativeElement.swiper?.slideTo(index);
  }
}
