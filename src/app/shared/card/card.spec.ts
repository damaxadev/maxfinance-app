import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { Card } from './card';

describe('Card', () => {
  let component: Card;
  let fixture: ComponentFixture<Card>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Card],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Card);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('toggles the pressed state on press start/end', async () => {
    expect(component.pressed()).toBe(false);

    await component.onPressStart();
    expect(component.pressed()).toBe(true);

    component.onPressEnd();
    expect(component.pressed()).toBe(false);
  });

  it('computes a stagger delay proportional to its index', () => {
    fixture.componentRef.setInput('index', 3);
    expect(component.animationParams.params.delay).toBe(180);
  });

  it('has no delay by default', () => {
    expect(component.animationParams.params.delay).toBe(0);
  });
});
