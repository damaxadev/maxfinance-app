import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AttachmentsService } from '../../../core/attachments/attachments';
import { Celebration } from '../../../core/celebration/celebration';
import { GoalEntriesService } from '../../../core/goal-entries/goal-entries';
import { GroupsService } from '../../../core/groups/groups';
import { GoalEntryForm } from './goal-entry-form';

const fakeGoal = {
  id: 'goal1',
  name: 'Vacaciones',
  members: ['u1'],
  createdBy: 'u1',
  createdAt: {} as never,
  type: 'savings' as const,
  goalMode: 'target' as const,
  targetAmount: 1000,
  celebrationAmount: null as number | null,
  reachedMilestones: [] as number[],
};

describe('GoalEntryForm', () => {
  let component: GoalEntryForm;
  let fixture: ComponentFixture<GoalEntryForm>;
  let create: ReturnType<typeof vi.fn>;
  let attachFile: ReturnType<typeof vi.fn>;
  let celebrate: ReturnType<typeof vi.fn>;
  let markMilestonesReached: ReturnType<typeof vi.fn>;
  let entries$ = of<{ type: 'contribution' | 'withdrawal'; amount: number }[]>([]);

  async function setUp(
    overrides: {
      entries?: { type: 'contribution' | 'withdrawal'; amount: number }[];
      targetAmount?: number;
      goalMode?: 'target' | 'open-ended';
      celebrationAmount?: number | null;
      reachedMilestones?: number[];
    } = {}
  ) {
    create = vi.fn().mockResolvedValue('entry1');
    attachFile = vi.fn().mockResolvedValue(undefined);
    celebrate = vi.fn().mockResolvedValue(undefined);
    markMilestonesReached = vi.fn().mockResolvedValue(undefined);
    entries$ = of(overrides.entries ?? []);

    await TestBed.configureTestingModule({
      imports: [GoalEntryForm],
      providers: [
        { provide: GoalEntriesService, useValue: { create, attachFile, entries$: () => entries$ } },
        {
          provide: GroupsService,
          useValue: {
            groups$: of([
              {
                ...fakeGoal,
                targetAmount: overrides.targetAmount ?? fakeGoal.targetAmount,
                goalMode: overrides.goalMode ?? fakeGoal.goalMode,
                celebrationAmount: overrides.celebrationAmount ?? fakeGoal.celebrationAmount,
                reachedMilestones: overrides.reachedMilestones ?? fakeGoal.reachedMilestones,
              },
            ]),
            markMilestonesReached,
          },
        },
        { provide: Celebration, useValue: { celebrate } },
        // mfx-attachment-picker (primer campo del form) inyecta esto
        // directo — se mockea para no depender de la instancia real, que
        // a su vez necesitaría Storage.
        { provide: AttachmentsService, useValue: { getDownloadUrl: vi.fn().mockResolvedValue(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GoalEntryForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('context', { groupId: 'goal1', groupName: 'Vacaciones' });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    return fixture;
  }

  it('should create', async () => {
    await setUp();
    expect(component).toBeTruthy();
  });

  it('defaults to "contribution" (Aporte)', async () => {
    await setUp();
    expect(component.typeValue()).toBe('contribution');
  });

  it('does not submit an invalid form', async () => {
    await setUp();
    component.form.patchValue({ amount: 0 });

    await component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('creates a contribution entry and emits saved', async () => {
    await setUp();
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.patchValue({ amount: 100, note: 'Ahorro' });

    await component.submit();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'goal1', type: 'contribution', amount: 100, note: 'Ahorro' })
    );
    expect(emitted.length).toBe(1);
  });

  it('creates a withdrawal entry once selected via the type toggle', async () => {
    await setUp();
    component.selectType('withdrawal');
    component.form.patchValue({ amount: 50 });

    await component.submit();

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'withdrawal' }));
  });

  it('shows a generic error message if creation fails, and does not celebrate', async () => {
    await setUp();
    create.mockRejectedValue(new Error('boom'));
    component.form.patchValue({ amount: 500 });

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos registrar el movimiento. Intenta de nuevo.');
    expect(celebrate).not.toHaveBeenCalled();
  });

  describe('hitos — modo "target"', () => {
    it('celebrates and persists every milestone crossed (0% -> 50% crosses both 25 and 50)', async () => {
      await setUp({ entries: [], targetAmount: 1000 });
      component.form.patchValue({ amount: 500 }); // 0% -> 50%

      await component.submit();

      expect(markMilestonesReached).toHaveBeenCalledWith('goal1', [25, 50]);
      expect(celebrate).toHaveBeenCalledTimes(1);
    });

    it('does NOT celebrate when no milestone is crossed (40% -> 45%)', async () => {
      await setUp({ entries: [{ type: 'contribution', amount: 400 }], targetAmount: 1000 });
      component.form.patchValue({ amount: 50 }); // 40% -> 45%

      await component.submit();

      expect(markMilestonesReached).not.toHaveBeenCalled();
      expect(celebrate).not.toHaveBeenCalled();
    });

    it('does NOT celebrate for a withdrawal that moves progress backward', async () => {
      await setUp({ entries: [{ type: 'contribution', amount: 600 }], targetAmount: 1000 });
      component.selectType('withdrawal');
      component.form.patchValue({ amount: 100 }); // 60% -> 50%, moving down

      await component.submit();

      expect(celebrate).not.toHaveBeenCalled();
    });

    it('celebrates only once even if a single entry crosses several milestones at once', async () => {
      await setUp({ entries: [], targetAmount: 1000 });
      component.form.patchValue({ amount: 1000 }); // 0% -> 100%, crosses 25/50/75/100

      await component.submit();

      expect(markMilestonesReached).toHaveBeenCalledWith('goal1', [25, 50, 75, 100]);
      expect(celebrate).toHaveBeenCalledTimes(1);
    });

    // Punto central de la ronda de feedback: un hito ya guardado en
    // Group.reachedMilestones no se vuelve a celebrar, aunque esta entrada
    // lo cruce "de nuevo" en el papel (un retiro bajó, un aporte subió).
    it('does NOT celebrate a milestone already reached before — "once in the goal\'s lifetime"', async () => {
      await setUp({
        entries: [{ type: 'contribution', amount: 400 }], // 40%
        targetAmount: 1000,
        reachedMilestones: [25, 50], // ya se celebró el 50% alguna vez (un retiro bajó a 40%)
      });
      component.form.patchValue({ amount: 150 }); // 40% -> 55%, vuelve a cruzar el 50% "en el papel"

      await component.submit();

      expect(markMilestonesReached).not.toHaveBeenCalled();
      expect(celebrate).not.toHaveBeenCalled();
    });

    it('still celebrates a NEW milestone even if an older one in the same jump was already reached', async () => {
      await setUp({
        entries: [{ type: 'contribution', amount: 200 }], // 20%
        targetAmount: 1000,
        reachedMilestones: [25], // ya celebrado antes (subió a 30%, bajó, etc.)
      });
      component.form.patchValue({ amount: 350 }); // 20% -> 55%, cruza 25 (ya visto) y 50 (nuevo)

      await component.submit();

      expect(markMilestonesReached).toHaveBeenCalledWith('goal1', [50]);
      expect(celebrate).toHaveBeenCalledTimes(1);
    });
  });

  describe('hitos — modo "open-ended" (solo ir ahorrando)', () => {
    it('celebrates and persists the multiple crossed (celebrationAmount 1.000.000)', async () => {
      await setUp({ entries: [], goalMode: 'open-ended', celebrationAmount: 1000000 });
      component.form.patchValue({ amount: 1000000 }); // cruza el primer múltiplo

      await component.submit();

      expect(markMilestonesReached).toHaveBeenCalledWith('goal1', [1]);
      expect(celebrate).toHaveBeenCalledTimes(1);
    });

    it('does NOT celebrate while still inside the current tier', async () => {
      await setUp({
        entries: [{ type: 'contribution', amount: 200000 }],
        goalMode: 'open-ended',
        celebrationAmount: 1000000,
      });
      component.form.patchValue({ amount: 300000 }); // 20% -> 50% del mismo tramo, no cruza

      await component.submit();

      expect(markMilestonesReached).not.toHaveBeenCalled();
      expect(celebrate).not.toHaveBeenCalled();
    });

    it('celebrates every multiple crossed by one large contribution at once', async () => {
      await setUp({ entries: [], goalMode: 'open-ended', celebrationAmount: 1000000 });
      component.form.patchValue({ amount: 3500000 }); // cruza el 1°, 2° y 3°

      await component.submit();

      expect(markMilestonesReached).toHaveBeenCalledWith('goal1', [1, 2, 3]);
      expect(celebrate).toHaveBeenCalledTimes(1);
    });

    it('does NOT re-celebrate a multiple already reached before (same "once in a lifetime" rule)', async () => {
      await setUp({
        entries: [{ type: 'contribution', amount: 800000 }],
        goalMode: 'open-ended',
        celebrationAmount: 1000000,
        reachedMilestones: [1], // ya había llegado al primer millón antes de un retiro
      });
      component.form.patchValue({ amount: 300000 }); // 800k -> 1.1M, vuelve a cruzar el 1° "en el papel"

      await component.submit();

      expect(markMilestonesReached).not.toHaveBeenCalled();
      expect(celebrate).not.toHaveBeenCalled();
    });
  });

  describe('adjunto (mfx-attachment-picker, primer campo)', () => {
    it('renders the picker as the first element inside the form', async () => {
      await setUp();

      const form = fixture.nativeElement.querySelector('form');
      expect(form.firstElementChild.tagName.toLowerCase()).toBe('mfx-attachment-picker');
    });

    it('does not call attachFile() when nothing was attached', async () => {
      await setUp();
      component.form.patchValue({ amount: 100 });

      await component.submit();

      expect(attachFile).not.toHaveBeenCalled();
    });

    it('uploads the pending attachment to the new entry id after creating it', async () => {
      await setUp();
      const pending = { blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'recibo.jpg' };
      component.pendingAttachment.set(pending);
      component.form.patchValue({ amount: 100 });

      await component.submit();

      expect(create).toHaveBeenCalled();
      expect(attachFile).toHaveBeenCalledWith('entry1', pending);
    });

    it('retrying after an attachment-upload failure does NOT re-create the entry or re-evaluate milestones', async () => {
      await setUp({ entries: [], targetAmount: 1000 });
      attachFile.mockRejectedValueOnce(new Error('network error'));
      component.pendingAttachment.set({ blob: new Blob(['x']), contentType: 'image/jpeg', fileName: 'a.jpg' });
      component.form.patchValue({ amount: 500 }); // 0% -> 50%, cruza 25 y 50 en ESTE primer submit

      await component.submit();
      fixture.detectChanges();
      expect(component.errorMessage()).toBe(
        'Guardamos el movimiento, pero no pudimos subir el archivo adjunto. Intenta de nuevo.'
      );
      expect(create).toHaveBeenCalledTimes(1);
      // El cruce de hitos ya se evaluó y celebró ANTES de llegar al adjunto
      // (que es lo que falló) — confirmado acá para que el siguiente
      // reintento pueda afirmar que esto no se repite.
      expect(celebrate).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain(
        'Reintentar subir adjunto'
      );

      const emitted: void[] = [];
      component.saved.subscribe(() => emitted.push(undefined));
      await component.submit(); // reintento — solo el adjunto, nada más

      expect(create).toHaveBeenCalledTimes(1); // no se repite
      expect(celebrate).toHaveBeenCalledTimes(1); // no se re-evalúa ni re-celebra
      expect(attachFile).toHaveBeenCalledTimes(2);
      expect(attachFile).toHaveBeenLastCalledWith('entry1', expect.objectContaining({ fileName: 'a.jpg' }));
      expect(emitted.length).toBe(1);
    });
  });
});
