import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { Movements } from './movements';

describe('Movements', () => {
  let component: Movements;
  let fixture: ComponentFixture<Movements>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Movements],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Movements);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
