import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ModalStack } from './modal-stack';

describe('ModalStack', () => {
  let service: ModalStack;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ModalStack);
  });

  it('starts with nothing open', () => {
    expect(service.hasOpen).toBe(false);
  });

  it('push() marks it as open', () => {
    service.push(vi.fn());
    expect(service.hasOpen).toBe(true);
  });

  it('closeTop(): calls the most recently pushed callback and removes it', () => {
    const first = vi.fn();
    const second = vi.fn();
    service.push(first);
    service.push(second);

    const handled = service.closeTop();

    expect(handled).toBe(true);
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(service.hasOpen).toBe(true); // "first" sigue en la pila
  });

  it('closeTop(): returns false and calls nothing when the stack is empty', () => {
    expect(service.closeTop()).toBe(false);
  });

  it('closeTop() twice unwinds the whole stack in LIFO order', () => {
    const first = vi.fn();
    const second = vi.fn();
    service.push(first);
    service.push(second);

    service.closeTop();
    service.closeTop();

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(service.hasOpen).toBe(false);
  });

  it('pop(): removes a specific callback without calling it (normal close, not the back button)', () => {
    const first = vi.fn();
    const second = vi.fn();
    service.push(first);
    service.push(second);

    service.pop(first);

    expect(first).not.toHaveBeenCalled();
    expect(service.hasOpen).toBe(true); // "second" sigue

    service.pop(second);
    expect(service.hasOpen).toBe(false);
  });

  it('pop(): is a no-op if the callback is not on the stack (already removed, e.g. by closeTop())', () => {
    const onBack = vi.fn();
    service.push(onBack);
    service.closeTop();

    expect(() => service.pop(onBack)).not.toThrow();
    expect(service.hasOpen).toBe(false);
  });
});
