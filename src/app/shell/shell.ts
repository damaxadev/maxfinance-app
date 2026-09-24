import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, OnDestroy, AfterViewInit, inject, viewChild, signal } from '@angular/core';
import type { SwiperContainer } from 'swiper/element';
import type { Swiper } from 'swiper';

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
import { GroupActivityFullState } from '../core/group-activity-full-state/group-activity-full-state';
import { GroupActivityFull } from '../features/groups/group-activity-full/group-activity-full';
import { SharedExpenseFormState } from '../core/shared-expense-form-state/shared-expense-form-state';
import { SharedExpenseForm } from '../features/groups/shared-expense-form/shared-expense-form';
import { SettlementFormState } from '../core/settlement-form-state/settlement-form-state';
import { SettlementForm } from '../features/groups/settlement-form/settlement-form';
import { RecurringPaymentFormState } from '../core/recurring-payment-form-state/recurring-payment-form-state';
import { RecurringPaymentForm } from '../features/recurring-payments/recurring-payment-form/recurring-payment-form';

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
    GroupActivityFull,
    SharedExpenseForm,
    SettlementForm,
    RecurringPaymentForm,
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
  readonly groupActivityFullState = inject(GroupActivityFullState);
  readonly sharedExpenseFormState = inject(SharedExpenseFormState);
  readonly settlementFormState = inject(SettlementFormState);
  readonly recurringPaymentFormState = inject(RecurringPaymentFormState);

  readonly activeIndex = signal(0);

  // Se suscribe directo a la instancia de Swiper (swiper.on/off), no al
  // CustomEvent 'slidechange' que <swiper-container> reenvía desde su shadow
  // root — un intermediario de más que dependía de que zone.js parcheara
  // ese addEventListener para disparar change detection. Los signals ya
  // notifican por sí mismos al escribir, sin depender de zone.js, así que
  // suscribirse a la fuente (el propio Swiper) es más directo y más robusto.
  private readonly handleSlideChange = (swiper: Swiper): void => {
    // this.activeIndex() ya puede coincidir si el cambio vino de un tab
    // (onTabSelected ya lo actualizó antes de llamar slideTo) — comparar
    // evita un set() redundante, no por loop (acá nunca se llama a
    // slideTo), sino para no re-emitir un valor que ya es el mismo.
    if (this.activeIndex() !== swiper.activeIndex) {
      this.activeIndex.set(swiper.activeIndex);
    }
  };

  ngAfterViewInit(): void {
    this.swiperEl().nativeElement.swiper?.on('slideChange', this.handleSlideChange);
  }

  ngOnDestroy(): void {
    this.swiperEl().nativeElement.swiper?.off('slideChange', this.handleSlideChange);
  }

  onTabSelected(index: number): void {
    this.activeIndex.set(index);
    this.swiperEl().nativeElement.swiper?.slideTo(index);
  }
}
