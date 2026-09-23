import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Avatar } from './avatar';

describe('Avatar', () => {
  let fixture: ComponentFixture<Avatar>;
  let component: Avatar;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Avatar] }).compileComponents();

    fixture = TestBed.createComponent(Avatar);
    fixture.componentRef.setInput('displayName', 'Diego');
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('shows the photo when photoUrl is set', () => {
    fixture.componentRef.setInput('photoUrl', 'https://example.com/diego.jpg');
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img.mfx-avatar');
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://example.com/diego.jpg');
    expect(fixture.nativeElement.querySelector('.mfx-avatar--fallback')).toBeNull();
  });

  it('shows the fallback with the uppercase initial when there is no photoUrl', () => {
    fixture.detectChanges();

    const fallback = fixture.nativeElement.querySelector('.mfx-avatar--fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent.trim()).toBe('D');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });

  it('falls back to "?" when displayName is empty', () => {
    fixture.componentRef.setInput('displayName', '');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-avatar--fallback').textContent.trim()).toBe('?');
  });

  it('falls back to the initial if the image fails to load', () => {
    fixture.componentRef.setInput('photoUrl', 'https://example.com/broken.jpg');
    fixture.detectChanges();

    const img: HTMLImageElement = fixture.nativeElement.querySelector('img.mfx-avatar');
    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mfx-avatar--fallback').textContent.trim()).toBe('D');
  });

  it('applies the configured size', () => {
    fixture.componentRef.setInput('size', 32);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement.querySelector('.mfx-avatar');
    expect(el.style.width).toBe('32px');
    expect(el.style.height).toBe('32px');
  });

  it('gives a fresh chance to load when photoUrl changes (e.g. reused for another person in a list)', () => {
    fixture.componentRef.setInput('photoUrl', 'https://example.com/broken.jpg');
    fixture.detectChanges();
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img.mfx-avatar');
    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(component.photoLoadError()).toBe(true);

    fixture.componentRef.setInput('photoUrl', 'https://example.com/another.jpg');
    fixture.detectChanges();

    expect(component.photoLoadError()).toBe(false);
    expect(fixture.nativeElement.querySelector('img.mfx-avatar')).toBeTruthy();
  });
});
