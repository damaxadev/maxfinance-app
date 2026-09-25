import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabBar } from './tab-bar';

describe('TabBar', () => {
  let component: TabBar;
  let fixture: ComponentFixture<TabBar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabBar],
    }).compileComponents();

    fixture = TestBed.createComponent(TabBar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the 5 sections in order, each with an icon', () => {
    const items = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.mfx-tab-bar__item'));

    expect(items.map((el) => el.textContent?.trim())).toEqual([
      '🏠 Inicio',
      '💳 Movimientos',
      '👥 Grupos',
      '🔁 Recurrentes',
      '⚙️ Ajustes',
    ]);
    for (const item of items) {
      expect(item.querySelector('.mfx-tab-bar__icon')).toBeTruthy();
    }
  });

  it('emits the tapped tab index', () => {
    const emitted: number[] = [];
    component.tabSelected.subscribe((index) => emitted.push(index));

    component.selectTab(2);

    expect(emitted).toEqual([2]);
  });

  it('marks the active tab based on activeIndex', () => {
    fixture.componentRef.setInput('activeIndex', 3);
    fixture.detectChanges();

    const active = fixture.nativeElement.querySelector('.mfx-tab-bar__item--active');
    expect(active.textContent.trim()).toBe('🔁 Recurrentes');
  });
});
