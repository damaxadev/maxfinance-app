import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { Home } from './home';
import { Accounts } from '../../../core/accounts/accounts';

const fakeAccounts = [
  { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 100000, currency: 'COP' },
  { id: 'acc2', uid: 'u1', name: 'Banco', type: 'banco' as const, balance: 250000, currency: 'COP' },
];

describe('Home', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideNoopAnimations(), { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } }],
    }).compileComponents();

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('sums the balance of all accounts for the hero total', () => {
    expect(component.totalBalance()).toBe(350000);
  });

  it('renders one card per account', () => {
    const rows = fixture.nativeElement.querySelectorAll('.mfx-home__account');
    expect(rows.length).toBe(2);
  });
});
