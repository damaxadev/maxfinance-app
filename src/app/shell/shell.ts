import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, OnDestroy, AfterViewInit, inject, viewChild, signal } from '@angular/core';
import type { SwiperContainer } from 'swiper/element';

import { TabBar } from './tab-bar/tab-bar';
import { Fab } from '../shared/fab/fab';
import { Modal } from '../shared/modal/modal';
import { Home } from './views/home/home';
import { Movements } from './views/movements/movements';
import { Groups } from './views/groups/groups';
import { Budget } from './views/budget/budget';
import { Settings } from './views/settings/settings';
import { MovementFormState } from '../core/movement-form-state/movement-form-state';
import { MovementForm } from '../features/movements/movement-form/movement-form';
import { AccountFormState } from '../core/account-form-state/account-form-state';
import { AccountForm } from '../features/accounts/account-form/account-form';
import { CategoryFormState } from '../core/category-form-state/category-form-state';
import { CategoryForm } from '../features/categories/category-form/category-form';
import { GroupFormState } from '../core/group-form-state/group-form-state';
import { GroupForm } from '../features/groups/group-form/group-form';
import { GroupDetailState } from '../core/group-detail-state/group-detail-state';
import { GroupDetail } from '../features/groups/group-detail/group-detail';

@Component({
  selector: 'mfx-shell',
  imports: [
    TabBar,
    Fab,
    Modal,
    MovementForm,
    AccountForm,
    CategoryForm,
    GroupForm,
    GroupDetail,
    Home,
    Movements,
    Groups,
    Budget,
    Settings,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class Shell implements AfterViewInit, OnDestroy {
  private readonly swiperEl = viewChild.required<ElementRef<SwiperContainer>>('swiperEl');
  readonly movementFormState = inject(MovementFormState);
  readonly accountFormState = inject(AccountFormState);
  readonly categoryFormState = inject(CategoryFormState);
  readonly groupFormState = inject(GroupFormState);
  readonly groupDetailState = inject(GroupDetailState);

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
