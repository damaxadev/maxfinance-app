import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { Budget } from './budget';

describe('Budget', () => {
  let component: Budget;
  let fixture: ComponentFixture<Budget>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Budget],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Budget);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
