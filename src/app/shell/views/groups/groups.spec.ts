import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { Groups } from './groups';

describe('Groups', () => {
  let component: Groups;
  let fixture: ComponentFixture<Groups>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Groups],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Groups);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
