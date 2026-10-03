import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { vi } from 'vitest';

import { AttachmentsService } from '../../core/attachments/attachments';
import { AttachmentPicker } from './attachment-picker';

const { mockTakePhoto, mockChooseFromGallery } = vi.hoisted(() => ({
  mockTakePhoto: vi.fn(),
  mockChooseFromGallery: vi.fn(),
}));

vi.mock('@capacitor/camera', () => ({
  Camera: { takePhoto: mockTakePhoto, chooseFromGallery: mockChooseFromGallery },
  MediaTypeSelection: { Photo: 0 },
}));

const { mockPickFiles } = vi.hoisted(() => ({ mockPickFiles: vi.fn() }));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: { pickFiles: mockPickFiles },
}));

const { mockBrowserOpen } = vi.hoisted(() => ({ mockBrowserOpen: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: mockBrowserOpen },
}));

import { MediaTypeSelection } from '@capacitor/camera';

function stubFetchResolvingBlob(blob: Blob): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AttachmentPicker', () => {
  let component: AttachmentPicker;
  let fixture: ComponentFixture<AttachmentPicker>;
  let getDownloadUrl: ReturnType<typeof vi.fn>;
  let prepare: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockTakePhoto.mockReset();
    mockChooseFromGallery.mockReset();
    mockPickFiles.mockReset();
    mockBrowserOpen.mockReset().mockResolvedValue(undefined);
    getDownloadUrl = vi.fn().mockResolvedValue('https://example.com/attachment');
    prepare = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AttachmentPicker],
      // AttachmentsService.prepare() es el envoltorio inyectable sobre la
      // función pura prepareAttachment() (ver attachment-compression.ts,
      // probada a fondo aparte) — se mockea acá vía TestBed en vez de
      // vi.mock sobre un import relativo, que el sistema de tests de
      // Angular no permite.
      providers: [provideNoopAnimations(), { provide: AttachmentsService, useValue: { getDownloadUrl, prepare } }],
    }).compileComponents();

    fixture = TestBed.createComponent(AttachmentPicker);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the empty invite state with the given text by default', () => {
    fixture.componentRef.setInput('inviteText', 'Adjunta la foto de un recibo y te completamos el gasto solos ✨');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-attachment-picker__zone--empty')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain(
      'Adjunta la foto de un recibo y te completamos el gasto solos ✨'
    );
  });

  it('tapping the empty zone opens the "tomar foto / elegir de galería / elegir PDF" menu', () => {
    fixture.nativeElement.querySelector('.mfx-attachment-picker__zone--empty').click();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.mfx-attachment-picker__menu');
    expect(menu).toBeTruthy();
    expect(menu.textContent).toContain('Tomar foto');
    expect(menu.textContent).toContain('Elegir foto de galería');
    expect(menu.textContent).toContain('Elegir PDF');
  });

  describe('takePhoto()', () => {
    it('calls Camera.takePhoto(), turns the resulting webPath into a File, prepares it and emits it', async () => {
      stubFetchResolvingBlob(new Blob(['x'], { type: 'image/jpeg' }));
      mockTakePhoto.mockResolvedValue({ webPath: 'blob:native-photo' });
      const preparedBlob = new Blob(['y'], { type: 'image/jpeg' });
      prepare.mockResolvedValue({ blob: preparedBlob, contentType: 'image/jpeg' });
      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
      component.menuOpen.set(true);

      await component.takePhoto();
      fixture.detectChanges();

      expect(mockTakePhoto).toHaveBeenCalledWith({ quality: 85 });
      expect(component.menuOpen()).toBe(false);
      const [file] = prepare.mock.calls[0];
      expect(file.name).toBe('foto.jpg');
      expect(file.type).toBe('image/jpeg');
      expect(component.pendingAttachment()).toEqual({
        blob: preparedBlob,
        contentType: 'image/jpeg',
        fileName: 'foto.jpg',
      });
    });

    it('swallows a cancel/error silently: no error message, nothing prepared', async () => {
      mockTakePhoto.mockRejectedValue(new Error('User cancelled photos app'));

      await component.takePhoto();

      expect(prepare).not.toHaveBeenCalled();
      expect(component.errorMessage()).toBeNull();
    });
  });

  describe('pickFromGallery()', () => {
    it('calls Camera.chooseFromGallery() restricted to photos and processes the first result', async () => {
      stubFetchResolvingBlob(new Blob(['x'], { type: 'image/png' }));
      mockChooseFromGallery.mockResolvedValue({ results: [{ webPath: 'blob:native-gallery-photo' }] });
      prepare.mockResolvedValue({ blob: new Blob(['y']), contentType: 'image/jpeg' });

      await component.pickFromGallery();

      expect(mockChooseFromGallery).toHaveBeenCalledWith({ mediaType: MediaTypeSelection.Photo, quality: 85 });
      expect(prepare).toHaveBeenCalled();
    });

    it('does nothing when the gallery returns no results (user cancelled without picking)', async () => {
      mockChooseFromGallery.mockResolvedValue({ results: [] });

      await component.pickFromGallery();

      expect(prepare).not.toHaveBeenCalled();
    });
  });

  describe('pickPdf()', () => {
    it('calls FilePicker.pickFiles() restricted to a single PDF and resolves a native PickedFile via webPath', async () => {
      stubFetchResolvingBlob(new Blob(['x'], { type: 'application/pdf' }));
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'recibo.pdf', mimeType: 'application/pdf', webPath: 'blob:native-pdf', size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['y']), contentType: 'application/pdf' });

      await component.pickPdf();

      expect(mockPickFiles).toHaveBeenCalledWith({ types: ['application/pdf'], limit: 1 });
      const [file] = prepare.mock.calls[0];
      expect(file.name).toBe('recibo.pdf');
    });

    it('on Web, uses the PickedFile.blob directly without touching fetch', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const webBlob = new Blob(['x'], { type: 'application/pdf' });
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'recibo.pdf', mimeType: 'application/pdf', blob: webBlob, size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['y']), contentType: 'application/pdf' });

      await component.pickPdf();

      expect(fetchMock).not.toHaveBeenCalled();
      const [file] = prepare.mock.calls[0];
      expect(file.name).toBe('recibo.pdf');
    });

    it('does nothing when the user cancels without picking a file', async () => {
      mockPickFiles.mockResolvedValue({ files: [] });

      await component.pickPdf();

      expect(prepare).not.toHaveBeenCalled();
    });
  });

  it('shows the PDF icon (not an image thumbnail) once a PDF is prepared', async () => {
    mockPickFiles.mockResolvedValue({
      files: [{ name: 'recibo.pdf', mimeType: 'application/pdf', blob: new Blob(['x']), size: 10 }],
    });
    prepare.mockResolvedValue({ blob: new Blob(['x'], { type: 'application/pdf' }), contentType: 'application/pdf' });

    await component.pickPdf();
    fixture.detectChanges();

    expect(component.pendingPreviewUrl()).toBeNull();
    expect(fixture.nativeElement.querySelector('.mfx-attachment-picker__pdf-icon')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.mfx-attachment-picker__thumb')).toBeNull();
  });

  it('shows the error message and does not emit anything when AttachmentsService.prepare() rejects', async () => {
    mockPickFiles.mockResolvedValue({
      files: [{ name: 'video.mp4', mimeType: 'video/mp4', blob: new Blob(['x']), size: 10 }],
    });
    prepare.mockRejectedValue(new Error('Solo se aceptan imágenes o archivos PDF.'));
    const emitted: unknown[] = [];
    component.attachmentReady.subscribe((value) => emitted.push(value));

    await component.pickPdf();
    fixture.detectChanges();

    expect(component.errorMessage()).toBe('Solo se aceptan imágenes o archivos PDF.');
    expect(component.pendingAttachment()).toBeNull();
    expect(emitted).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Solo se aceptan imágenes o archivos PDF.');
  });

  it('clear() resets the pending state and emits null', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
    mockPickFiles.mockResolvedValue({
      files: [{ name: 'a.png', mimeType: 'image/png', blob: new Blob(['x']), size: 10 }],
    });
    prepare.mockResolvedValue({ blob: new Blob(['x']), contentType: 'image/jpeg' });
    await component.pickPdf();
    const emitted: unknown[] = [];
    component.attachmentReady.subscribe((value) => emitted.push(value));

    component.clear();

    expect(component.pendingAttachment()).toBeNull();
    expect(component.pendingPreviewUrl()).toBeNull();
    expect(emitted).toEqual([null]);
  });

  describe('modo edición (existingPath)', () => {
    it('resolves and shows a download URL for the existing attachment', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();

      expect(getDownloadUrl).toHaveBeenCalledWith('movements/m1/attachment');
      expect(component.existingUrl()).toBe('https://example.com/attachment');
      expect(fixture.nativeElement.textContent).toContain('Toca para verlo');
    });

    it('readOnly(): shows only a view button (opens the attachment via @capacitor/browser, no replace/options affordance)', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.componentRef.setInput('existingContentType', 'application/pdf');
      fixture.componentRef.setInput('readOnly', true);
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();

      const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-attachment-picker__view-link');
      expect(button).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.mfx-attachment-picker__options-trigger')).toBeNull();

      button.click();
      await Promise.resolve();

      expect(mockBrowserOpen).toHaveBeenCalledWith({ url: 'https://example.com/attachment' });
    });

    it('readOnly() with no existing attachment renders nothing at all', () => {
      fixture.componentRef.setInput('readOnly', true);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent?.trim()).toBe('');
    });
  });

  it('shows a busy "Eliminando adjunto…" state when removing() is true', () => {
    fixture.componentRef.setInput('removing', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Eliminando adjunto…');
  });

  describe('abrir/previsualizar el adjunto (tap principal — antes reemplazaba, ahora abre)', () => {
    it('tapping a saved image opens the full-screen viewer with existingUrl()', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.componentRef.setInput('existingContentType', 'image/jpeg');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.mfx-attachment-picker__zone--filled').click();
      fixture.detectChanges();

      expect(component.viewerUrl()).toBe('https://example.com/attachment');
      expect(fixture.nativeElement.querySelector('mfx-image-viewer')).toBeTruthy();
    });

    it('tapping a saved PDF calls Browser.open() (Chrome Custom Tabs) instead of the viewer', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.componentRef.setInput('existingContentType', 'application/pdf');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.mfx-attachment-picker__zone--filled').click();
      await Promise.resolve();

      expect(mockBrowserOpen).toHaveBeenCalledWith({ url: 'https://example.com/attachment' });
      expect(component.viewerUrl()).toBeNull();
    });

    it('tapping a pending (not yet uploaded) PDF shows "guarda primero" instead of opening anything — Browser.open() crashes on a blob: URL', async () => {
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'recibo.pdf', mimeType: 'application/pdf', blob: new Blob(['x']), size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['x'], { type: 'application/pdf' }), contentType: 'application/pdf' });
      await component.pickPdf();
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.mfx-attachment-picker__zone--filled').click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(mockBrowserOpen).not.toHaveBeenCalled();
      expect(component.viewerUrl()).toBeNull();
      expect(component.errorMessage()).toBe('Guarda primero para ver el PDF.');
      expect(fixture.nativeElement.textContent).toContain('Guarda primero para ver el PDF.');
    });

    it('tapping a pending (not yet uploaded) image opens the viewer with its local preview URL', async () => {
      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'a.png', mimeType: 'image/png', blob: new Blob(['x']), size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['x'], { type: 'image/jpeg' }), contentType: 'image/jpeg' });
      await component.pickPdf();
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.mfx-attachment-picker__zone--filled').click();

      expect(component.viewerUrl()).toBe('blob:preview');
    });

    it('closing the viewer clears viewerUrl()', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.componentRef.setInput('existingContentType', 'image/jpeg');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();
      component.openAttachment();
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.mfx-image-viewer__close').click();
      fixture.detectChanges();

      expect(component.viewerUrl()).toBeNull();
    });
  });

  describe('menú de opciones (⋮ — Reemplazar / Eliminar / Quitar)', () => {
    it('tapping ⋮ on a saved attachment opens "Reemplazar" + "Eliminar", without opening the viewer', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.componentRef.setInput('existingContentType', 'image/jpeg');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.mfx-attachment-picker__options-trigger').click();
      fixture.detectChanges();

      expect(component.viewerUrl()).toBeNull();
      const menu = fixture.nativeElement.querySelector('.mfx-attachment-picker__menu');
      expect(menu.textContent).toContain('Reemplazar');
      expect(menu.textContent).toContain('Eliminar');
      expect(menu.textContent).not.toContain('Quitar');
    });

    it('"Reemplazar" closes the options menu and opens the source-choice menu', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();
      component.openOptionsMenu(new Event('click'));
      fixture.detectChanges();

      component.replaceFromOptionsMenu();
      fixture.detectChanges();

      expect(component.optionsMenuOpen()).toBe(false);
      expect(component.menuOpen()).toBe(true);
    });

    it('"Eliminar" asks for confirmation before emitting existingRemoved', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();
      const emitted: void[] = [];
      component.existingRemoved.subscribe(() => emitted.push(undefined));
      component.openOptionsMenu(new Event('click'));
      fixture.detectChanges();

      component.askRemoveExisting();
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(fixture.nativeElement.textContent).toContain('no se puede deshacer');

      component.confirmRemoveExisting();

      expect(emitted.length).toBe(1);
      expect(component.optionsMenuOpen()).toBe(false);
    });

    it('"Cancelar" on the confirm step backs out without emitting existingRemoved', async () => {
      fixture.componentRef.setInput('existingPath', 'movements/m1/attachment');
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();
      const emitted: void[] = [];
      component.existingRemoved.subscribe(() => emitted.push(undefined));
      component.openOptionsMenu(new Event('click'));
      component.askRemoveExisting();

      component.cancelRemoveExisting();
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(component.confirmingRemove()).toBe(false);
      expect(component.optionsMenuOpen()).toBe(true);
    });

    it('tapping ⋮ on a pending (not yet uploaded) attachment opens "Reemplazar" + "Quitar", not "Eliminar"', async () => {
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'a.png', mimeType: 'image/png', blob: new Blob(['x']), size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['x']), contentType: 'image/jpeg' });
      await component.pickPdf();
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.mfx-attachment-picker__options-trigger').click();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector('.mfx-attachment-picker__menu');
      expect(menu.textContent).toContain('Reemplazar');
      expect(menu.textContent).toContain('Quitar');
      expect(menu.textContent).not.toContain('Eliminar');
    });

    it('"Quitar" on a pending attachment clears it immediately (no confirm step, nothing to lose yet)', async () => {
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'a.png', mimeType: 'image/png', blob: new Blob(['x']), size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['x']), contentType: 'image/jpeg' });
      await component.pickPdf();
      const emitted: unknown[] = [];
      component.attachmentReady.subscribe((value) => emitted.push(value));
      component.openOptionsMenu(new Event('click'));

      component.quitPending();

      expect(component.pendingAttachment()).toBeNull();
      expect(emitted).toEqual([null]);
      expect(component.optionsMenuOpen()).toBe(false);
    });
  });

  // AttachmentsService del provider de arriba no incluye prepareForAi() (no
  // hacía falta antes de esta función) — cada test se lo agrega encima de
  // la misma instancia inyectada vía Object.assign(), más simple que
  // reconfigurar todo el TestBed solo para este grupo.
  describe('prepareAiPreview (copia de mayor calidad para ReceiptReader)', () => {
    it('is off by default: processFile() never calls prepareForAi(), aiPreview stays undefined', async () => {
      const prepareForAiSpy = vi.fn();
      Object.assign(TestBed.inject(AttachmentsService), { prepareForAi: prepareForAiSpy });
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'a.png', mimeType: 'image/png', blob: new Blob(['x']), size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['x']), contentType: 'image/jpeg' });

      await component.pickPdf();

      expect(prepareForAiSpy).not.toHaveBeenCalled();
      expect(component.pendingAttachment()?.aiPreview).toBeUndefined();
    });

    it('when on, processFile() also calls prepareForAi() and includes the result as aiPreview', async () => {
      const preview = { base64: 'BASE64', mediaType: 'image/jpeg' };
      const prepareForAiSpy = vi.fn().mockResolvedValue(preview);
      Object.assign(TestBed.inject(AttachmentsService), { prepareForAi: prepareForAiSpy });
      fixture.componentRef.setInput('prepareAiPreview', true);
      mockPickFiles.mockResolvedValue({
        files: [{ name: 'a.png', mimeType: 'image/png', blob: new Blob(['x']), size: 10 }],
      });
      prepare.mockResolvedValue({ blob: new Blob(['x']), contentType: 'image/jpeg' });

      await component.pickPdf();

      expect(prepareForAiSpy).toHaveBeenCalled();
      expect(component.pendingAttachment()?.aiPreview).toEqual(preview);
    });
  });
});
