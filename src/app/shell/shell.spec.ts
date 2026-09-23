import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { Shell } from './shell';

// El bundle real de Swiper (swiper/element/bundle) se registra en main.ts,
// que los tests unitarios no ejecutan. Acá definimos un <swiper-container>
// mínimo para probar nuestra lógica de integración sin el motor real
// (que depende de APIs de touch/resize que jsdom no implementa).
class FakeSwiperContainer extends HTMLElement {
  swiper = {
    activeIndex: 0,
    slideTo: vi.fn((index: number) => {
      this.swiper.activeIndex = index;
    }),
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
      providers: [provideNoopAnimations(), provideRouter([])],
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
    swiperEl().dispatchEvent(new CustomEvent('slidechange'));

    expect(component.activeIndex()).toBe(4);
  });
});
