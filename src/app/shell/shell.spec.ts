import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Shell } from './shell';
import { ActiveTabState } from '../core/active-tab-state/active-tab-state';
import { Auth } from '../core/auth/auth';
import { Accounts } from '../core/accounts/accounts';
import { Budgets } from '../core/budgets/budgets';
import { Categories } from '../core/categories/categories';
import { MonthlyInsights } from '../core/monthly-insights/monthly-insights';
import { MovementsService } from '../core/movements/movements';
import { Notifications } from '../core/notifications/notifications';
import { RecurringPayments } from '../core/recurring-payments/recurring-payments';
import { SettlementsService } from '../core/settlements/settlements';
import { GroupsService } from '../core/groups/groups';
import { Fab } from '../shared/fab/fab';
import { MovementForm } from '../features/movements/movement-form/movement-form';
import { AccountForm } from '../features/accounts/account-form/account-form';
import { CategoryForm } from '../features/categories/category-form/category-form';
import { GroupForm } from '../features/groups/group-form/group-form';
import { GroupDetail } from '../features/groups/group-detail/group-detail';
import { RecurringPaymentForm } from '../features/recurring-payments/recurring-payment-form/recurring-payment-form';

// Shell siempre renderiza Home como uno de sus swiper-slides, y Home crea
// gráficas Chart.js reales — jsdom no implementa un contexto 2D de canvas
// (mismo motivo que se mockea en home.spec.ts), así que sin este mock,
// CUALQUIER test de Shell fallaría al montar Home. No se necesita inspeccionar
// las instancias acá, solo que no explote.
vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    data = { labels: [], datasets: [{ data: [] }] };
    update = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));

const fakeGroup = { id: 'group1', name: 'Apartamento', members: ['u1'], createdBy: 'u1', createdAt: {} as never };

// El bundle real de Swiper (swiper/element/bundle) se registra en main.ts,
// que los tests unitarios no ejecutan. Acá definimos un <swiper-container>
// mínimo para probar nuestra lógica de integración sin el motor real (que
// depende de APIs de touch/resize que jsdom no implementa) — incluyendo
// on/off/emit, ya que Shell se suscribe directo a swiper.on('slideChange',
// ...) en vez del CustomEvent DOM que el elemento reenvía en el navegador real.
class FakeSwiperContainer extends HTMLElement {
  private readonly listeners = new Map<string, Set<(swiper: unknown) => void>>();

  swiper = {
    activeIndex: 0,
    slideTo: vi.fn((index: number) => {
      this.swiper.activeIndex = index;
    }),
    on: (event: string, handler: (swiper: unknown) => void) => {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: (swiper: unknown) => void) => {
      this.listeners.get(event)?.delete(handler);
    },
    // Simula el emit() real de Swiper para un evento — invoca cada handler
    // registrado con la instancia de swiper como argumento (misma convención
    // que swiper-core: swiper.on('slideChange', (swiper) => {...})).
    emit: (event: string) => {
      this.listeners.get(event)?.forEach((handler) => handler(this.swiper));
    },
  };
}
class FakeSwiperSlide extends HTMLElement {}

if (!customElements.get('swiper-container')) {
  customElements.define('swiper-container', FakeSwiperContainer);
}
if (!customElements.get('swiper-slide')) {
  customElements.define('swiper-slide', FakeSwiperSlide);
}

describe('Shell', () => {
  let component: Shell;
  let fixture: ComponentFixture<Shell>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: Accounts, useValue: { accounts$: of([]) } },
        { provide: Categories, useValue: { categories$: of([]) } },
        {
          provide: MovementsService,
          useValue: {
            personalMovements$: of([]),
            groupMovements$: () => of([]),
            sharedMovementsForGroups$: () => of([]),
            allSharedMovementsForGroups$: () => of([]),
            combinedMovements$: () => of([]),
            countGroupMovements: vi.fn().mockResolvedValue(0),
          },
        },
        { provide: Budgets, useValue: { budgetsForMonth$: () => of([]) } },
        { provide: RecurringPayments, useValue: { personalRecurringPayments$: of([]) } },
        {
          provide: Notifications,
          useValue: { checkStatus: vi.fn().mockResolvedValue('prompt'), enable: vi.fn().mockResolvedValue('granted') },
        },
        {
          provide: SettlementsService,
          useValue: {
            settlements$: () => of([]),
            settlementsForGroups$: () => of([]),
            findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
            countGroupSettlements: vi.fn().mockResolvedValue(0),
          },
        },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([fakeGroup]),
            getMemberProfiles: vi.fn().mockResolvedValue([]),
            getKnownContacts: vi.fn().mockResolvedValue([]),
          },
        },
        // GroupDetail inyecta Auth directamente (para saber "quién soy" y
        // decidir qué botón mostrar por fila) — se mockea acá en vez de
        // dejar que se construya la real, que a su vez necesitaría Firestore.
        {
          provide: Auth,
          useValue: { currentUser: { uid: 'u1' }, currentUser$: of({ uid: 'u1', displayName: 'Diego', photoUrl: '' }) },
        },
        // BalancesModal (dentro de Inicio) inyecta MonthlyInsights — se
        // mockea acá por el mismo motivo que Auth arriba (la real necesita
        // Firestore, que este TestBed no provee).
        { provide: MonthlyInsights, useValue: { lastMonthInsight$: of(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Shell);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function swiperEl(): FakeSwiperContainer {
    return fixture.nativeElement.querySelector('swiper-container');
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the 5 placeholder sections as swiper slides', () => {
    const slides = fixture.nativeElement.querySelectorAll('swiper-slide');
    expect(slides.length).toBe(5);
  });

  it('starts on tab 0', () => {
    expect(component.activeIndex()).toBe(0);
  });

  it('tapping a tab slides the swiper to that index', () => {
    component.onTabSelected(2);

    expect(component.activeIndex()).toBe(2);
    expect(swiperEl().swiper.slideTo).toHaveBeenCalledWith(2);
  });

  it('swiping updates the active tab index', () => {
    swiperEl().swiper.activeIndex = 4;
    swiperEl().swiper.emit('slideChange');

    expect(component.activeIndex()).toBe(4);
  });

  it('does not re-set activeIndex when swiper reports the same index it already has', () => {
    component.onTabSelected(2); // ya deja activeIndex() en 2

    // Simula el propio slideChange que dispara internamente ese slideTo(2)
    // — no debería ser un problema (no hay loop, nunca se llama slideTo()
    // desde este camino), pero confirma que el valor sigue siendo 2.
    swiperEl().swiper.activeIndex = 2;
    swiperEl().swiper.emit('slideChange');

    expect(component.activeIndex()).toBe(2);
  });

  it('unsubscribes from slideChange on destroy', () => {
    const swiper = swiperEl().swiper;
    fixture.destroy();

    swiper.activeIndex = 3;
    expect(() => swiper.emit('slideChange')).not.toThrow();
  });

  it('opens the movement form (create mode) when the FAB requests it', () => {
    const fab = fixture.debugElement.query(By.directive(Fab)).componentInstance as Fab;
    fab.movementRequested.emit();
    fixture.detectChanges();

    expect(component.movementFormState.request()).toEqual({ mode: 'create', groupId: null });
  });

  it('opens the create-group form when the FAB requests it', () => {
    const fab = fixture.debugElement.query(By.directive(Fab)).componentInstance as Fab;
    fab.groupRequested.emit();
    fixture.detectChanges();

    expect(component.groupFormState.open()).toBe(true);
  });

  it('slides to the requested tab via ActiveTabState (e.g. a dashboard section header)', () => {
    const activeTabState = TestBed.inject(ActiveTabState);

    activeTabState.requestTab(3);
    fixture.detectChanges();

    expect(component.activeIndex()).toBe(3);
    expect(swiperEl().swiper.slideTo).toHaveBeenCalledWith(3);
    expect(activeTabState.requestedIndex()).toBeNull();
  });

  it('opens the create-recurring-payment form when the FAB requests it', () => {
    const fab = fixture.debugElement.query(By.directive(Fab)).componentInstance as Fab;
    fab.recurringRequested.emit();
    fixture.detectChanges();

    expect(component.recurringPaymentFormState.request()).toEqual({ mode: 'create' });
  });

  it('renders the movement form modal once a request is open', () => {
    component.movementFormState.openCreate();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-modal')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mfx-movement-form')).toBeTruthy();
  });

  it('closes the modal when the movement form is saved', () => {
    component.movementFormState.openCreate();
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(MovementForm)).componentInstance as MovementForm;
    form.saved.emit();
    fixture.detectChanges();

    expect(component.movementFormState.request()).toBeNull();
  });

  it('renders the account form modal once a request is open', () => {
    component.accountFormState.openCreate();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-account-form')).toBeTruthy();
  });

  it('closes the account modal when the account form is saved', () => {
    component.accountFormState.openCreate();
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(AccountForm)).componentInstance as AccountForm;
    form.saved.emit();
    fixture.detectChanges();

    expect(component.accountFormState.request()).toBeNull();
  });

  it('renders the category form modal once a request is open', () => {
    component.categoryFormState.openCreate();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-category-form')).toBeTruthy();
  });

  it('closes the category modal when the category form is saved, and records what was saved', () => {
    component.categoryFormState.openCreate();
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(CategoryForm)).componentInstance as CategoryForm;
    form.saved.emit({ id: 'cat-new', type: 'expense' });
    fixture.detectChanges();

    expect(component.categoryFormState.request()).toBeNull();
    expect(component.categoryFormState.lastSaved()).toEqual({ id: 'cat-new', type: 'expense' });
  });

  it('renders the create-group form modal once open', () => {
    component.groupFormState.openCreate();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-group-form')).toBeTruthy();
  });

  it('closes the group form modal when the group is saved', () => {
    component.groupFormState.openCreate();
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(GroupForm)).componentInstance as GroupForm;
    form.saved.emit();
    fixture.detectChanges();

    expect(component.groupFormState.open()).toBe(false);
  });

  it('renders the group detail modal once a group id is open', () => {
    component.groupDetailState.open('group1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-group-detail')).toBeTruthy();
  });

  it('closes the group detail modal when the user leaves the group', () => {
    component.groupDetailState.open('group1');
    fixture.detectChanges();

    const detail = fixture.debugElement.query(By.directive(GroupDetail)).componentInstance as GroupDetail;
    detail.left.emit();
    fixture.detectChanges();

    expect(component.groupDetailState.groupId()).toBeNull();
  });

  it('renders the "ver toda la actividad" modal once a group id is open', () => {
    component.groupActivityFullState.open('group1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-group-activity-full')).toBeTruthy();
  });

  it('closes the group activity full modal via the shared state', () => {
    component.groupActivityFullState.open('group1');
    fixture.detectChanges();

    component.groupActivityFullState.close();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-group-activity-full')).toBeNull();
  });

  it('renders the recurring payment form modal once a request is open', () => {
    component.recurringPaymentFormState.openCreate();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-recurring-payment-form')).toBeTruthy();
  });

  it('closes the recurring payment modal when the form is saved', () => {
    component.recurringPaymentFormState.openCreate();
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(RecurringPaymentForm)).componentInstance as RecurringPaymentForm;
    form.saved.emit();
    fixture.detectChanges();

    expect(component.recurringPaymentFormState.request()).toBeNull();
  });

  it('renders the balances modal once BalancesModalState is open', () => {
    component.balancesModalState.show();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-balances-modal')).toBeTruthy();
  });

  it('closes the balances modal via the shared state', () => {
    component.balancesModalState.show();
    fixture.detectChanges();

    component.balancesModalState.close();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-balances-modal')).toBeNull();
  });
});
