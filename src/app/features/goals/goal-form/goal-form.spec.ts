import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { GroupsService } from '../../../core/groups/groups';
import { GoalForm } from './goal-form';

describe('GoalForm', () => {
  let component: GoalForm;
  let fixture: ComponentFixture<GoalForm>;
  let createGoal: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createGoal = vi.fn().mockResolvedValue('new-goal-id');

    await TestBed.configureTestingModule({
      imports: [GoalForm],
      providers: [{ provide: GroupsService, useValue: { createGoal } }],
    }).compileComponents();

    fixture = TestBed.createComponent(GoalForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to "target" mode, with "Con monto objetivo" marked active', () => {
    expect(component.goalModeValue()).toBe('target');
    const activeMode: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-goal-form__mode--active');
    expect(activeMode.textContent).toContain('Con monto objetivo');
  });

  it('does not submit an invalid form', async () => {
    await component.submit();

    expect(createGoal).not.toHaveBeenCalled();
  });

  it('shows a visible error under Nombre when empty and touched', async () => {
    await component.submit();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.mfx-form__error');
    expect(error?.textContent).toContain('El nombre es obligatorio.');
  });

  describe('modo "target" (con monto objetivo)', () => {
    it('requires a target amount greater than 0', async () => {
      component.form.patchValue({ name: 'Vacaciones', targetAmount: 0 });

      await component.submit();

      expect(createGoal).not.toHaveBeenCalled();
      expect(component.form.controls.targetAmount.hasError('min')).toBe(true);
    });

    it('creates a goal with goalMode "target", no target date and no reminder by default, and emits saved', async () => {
      const emitted: void[] = [];
      component.saved.subscribe(() => emitted.push(undefined));
      component.form.patchValue({ name: 'Vacaciones', targetAmount: 2000000 });

      await component.submit();

      expect(createGoal).toHaveBeenCalledWith({
        name: 'Vacaciones',
        goalMode: 'target',
        targetAmount: 2000000,
        celebrationAmount: null,
        targetDate: null,
        reminderFrequency: null,
        reminderSuggestedAmount: null,
      });
      expect(emitted.length).toBe(1);
    });

    it('parses the optional target date at local noon (avoids the UTC-midnight day-shift bug)', async () => {
      component.form.patchValue({ name: 'Vacaciones', targetAmount: 2000000, targetDate: '2026-12-01' });

      await component.submit();

      const [input] = createGoal.mock.calls[0];
      expect(input.targetDate.getFullYear()).toBe(2026);
      expect(input.targetDate.getMonth()).toBe(11);
      expect(input.targetDate.getDate()).toBe(1);
      expect(input.targetDate.getHours()).toBe(12);
    });
  });

  describe('modo "open-ended" (solo ir ahorrando)', () => {
    function selectOpenEnded(): void {
      const modeButtons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.mfx-goal-form__mode'));
      const openEndedButton = modeButtons.find((b) => b.textContent?.includes('Solo ir ahorrando'))!;
      openEndedButton.click();
      fixture.detectChanges();
    }

    it('selecting it via the mode buttons switches goalModeValue() and the active class', () => {
      selectOpenEnded();

      expect(component.goalModeValue()).toBe('open-ended');
      const activeMode: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-goal-form__mode--active');
      expect(activeMode.textContent).toContain('Solo ir ahorrando');
    });

    it('shows "Monto de celebración" (not "Monto objetivo") pre-filled with 1.000.000, editable', () => {
      selectOpenEnded();

      expect(fixture.nativeElement.textContent).toContain('Monto de celebración');
      expect(fixture.nativeElement.textContent).not.toContain('Monto objetivo');
      expect(component.form.controls.celebrationAmount.value).toBe(1000000);
    });

    it('hides the target-date field — it only makes sense alongside a fixed target', () => {
      selectOpenEnded();

      expect(fixture.nativeElement.textContent).not.toContain('Fecha objetivo');
    });

    it('requires a celebration amount greater than 0, and no longer requires targetAmount', async () => {
      selectOpenEnded();
      component.form.patchValue({ name: 'Vacaciones', celebrationAmount: 0 });

      await component.submit();

      expect(createGoal).not.toHaveBeenCalled();
      expect(component.form.controls.celebrationAmount.hasError('min')).toBe(true);
      expect(component.form.controls.targetAmount.hasError('required')).toBe(false);
    });

    it('creates a goal with goalMode "open-ended", celebrationAmount set and targetAmount null', async () => {
      selectOpenEnded();
      component.form.patchValue({ name: 'Ahorro libre', celebrationAmount: 500000 });

      await component.submit();

      expect(createGoal).toHaveBeenCalledWith(
        expect.objectContaining({ goalMode: 'open-ended', targetAmount: null, celebrationAmount: 500000 })
      );
    });

    it('switching back to "target" restores its validation and drops celebrationAmount from the payload', async () => {
      selectOpenEnded();
      const modeButtons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.mfx-goal-form__mode'));
      const targetButton = modeButtons.find((b) => b.textContent?.includes('Con monto objetivo'))!;
      targetButton.click();
      fixture.detectChanges();
      component.form.patchValue({ name: 'Vacaciones', targetAmount: 2000000 });

      await component.submit();

      expect(createGoal).toHaveBeenCalledWith(
        expect.objectContaining({ goalMode: 'target', targetAmount: 2000000, celebrationAmount: null })
      );
    });
  });

  it('shows the suggested-amount field only once a reminder frequency is chosen', () => {
    expect(fixture.nativeElement.textContent).not.toContain('Monto sugerido');

    component.form.controls.reminderFrequency.setValue('weekly');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Monto sugerido');
  });

  it('includes reminderFrequency and reminderSuggestedAmount when a frequency is chosen', async () => {
    component.form.patchValue({
      name: 'Vacaciones',
      targetAmount: 2000000,
      reminderFrequency: 'weekly',
      reminderSuggestedAmount: 50000,
    });

    await component.submit();

    expect(createGoal).toHaveBeenCalledWith(
      expect.objectContaining({ reminderFrequency: 'weekly', reminderSuggestedAmount: 50000 })
    );
  });

  it('drops the suggested amount (sends null) when left at 0, even with a frequency chosen', async () => {
    component.form.patchValue({ name: 'Vacaciones', targetAmount: 2000000, reminderFrequency: 'monthly' });

    await component.submit();

    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({ reminderSuggestedAmount: null }));
  });

  it('shows a generic error message if creation fails', async () => {
    createGoal.mockRejectedValue(new Error('boom'));
    component.form.patchValue({ name: 'Vacaciones', targetAmount: 2000000 });

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos crear la meta. Intenta de nuevo.');
  });
});
