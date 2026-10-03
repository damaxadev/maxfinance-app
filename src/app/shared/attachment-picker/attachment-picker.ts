import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { Camera, MediaTypeSelection, type MediaResult } from '@capacitor/camera';
import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';

import { ImageViewer } from '../image-viewer/image-viewer';
import { Modal } from '../modal/modal';
import { AttachmentsService } from '../../core/attachments/attachments';
import type { AiPreview } from '../../core/attachments/attachment-compression';

export interface PendingAttachment {
  blob: Blob;
  contentType: string;
  fileName: string;
  // Copia de mayor calidad para ReceiptReader (ver prepareAiPreview() más
  // abajo) — ausente salvo que el form la pida explícitamente, y null si
  // prepareForAi() no logró generarla (nunca bloquea el adjunto real).
  aiPreview?: AiPreview | null;
}

// Control de adjuntar archivo (imagen o PDF, uno solo) — ver DATABASE.md /
// "Adjuntos". Solo prepara el archivo (comprime si es imagen, valida tope
// de tamaño) y lo emite vía attachmentReady(); NUNCA sube nada por su
// cuenta — quien sube es el servicio del documento dueño (MovementsService.
// attachFile()/GoalEntriesService.attachFile()), después de que el
// formulario ya creó/actualizó ese documento (ver esos archivos para el
// motivo: la regla de Storage necesita que el doc ya exista).
//
// Fotos vía @capacitor/camera (takePhoto/chooseFromGallery — pide su propio
// permiso nativo en tiempo de uso, cada uno por separado) y PDF vía
// @capawesome/capacitor-file-picker (pickFiles — no pide ningún permiso,
// abre el selector de documentos del sistema). Ninguno de los dos se
// orquesta a mano: Android pregunta solo la primera vez que cada uno se usa.
@Component({
  selector: 'mfx-attachment-picker',
  imports: [Modal, ImageViewer],
  templateUrl: './attachment-picker.html',
  styleUrl: './attachment-picker.scss',
})
export class AttachmentPicker {
  private readonly attachmentsService = inject(AttachmentsService);

  // Adjunto YA guardado (modo edición) — solo el path/contentType, nunca
  // el blob: se resuelve una URL de descarga en vivo (ver el effect() del
  // constructor), no se asume que el visor ya la tiene a mano.
  readonly existingPath = input<string | null>(null);
  readonly existingContentType = input<string | null>(null);
  // Solo lectura (ver readOnly()/isLocked() en SharedExpenseForm) — sigue
  // mostrando el adjunto ya guardado (si hay) y se puede abrir para verlo,
  // pero sin reemplazar ni eliminar: el permiso de Storage tampoco lo
  // permitiría.
  readonly readOnly = input(false);
  readonly inviteText = input('Adjunta un archivo y te completamos los datos solos ✨');
  // El padre está borrando el adjunto existente (ver existingRemoved más
  // abajo) — lo controla el padre porque quien de verdad borra en Storage/
  // Firestore es el servicio del documento dueño, nunca este componente.
  readonly removing = input(false);
  // Además de la copia agresiva para Storage, calcula una de mayor calidad
  // para lectura automática por IA (ver ReceiptReader) — false por defecto
  // (solo MovementForm la pide hoy), para no gastar ese trabajo extra en
  // los formularios que no la usan.
  readonly prepareAiPreview = input(false);

  readonly attachmentReady = output<PendingAttachment | null>();
  // El usuario confirmó eliminar el adjunto YA guardado (acción secundaria,
  // ver optionsMenuOpen) — a diferencia de clear() (que solo descarta un
  // pick pendiente sin subir), esto SÍ necesita que el padre borre algo
  // real en Storage/Firestore, por eso es un evento aparte en vez de
  // reusar attachmentReady(null).
  readonly existingRemoved = output<void>();

  readonly pendingAttachment = signal<PendingAttachment | null>(null);
  readonly pendingPreviewUrl = signal<string | null>(null);
  readonly existingUrl = signal<string | null>(null);
  readonly compressing = signal(false);
  readonly errorMessage = signal<string | null>(null);
  // Menú "tomar foto / elegir de galería / elegir PDF" — reutiliza
  // <mfx-modal> (bottom sheet + botón atrás de Android vía ModalStack, ver
  // Modal) en vez de montar un backdrop propio.
  readonly menuOpen = signal(false);
  // Menú secundario "Reemplazar / Eliminar (o Quitar)" — ver ADICIONAL en
  // la conversación: el tap principal sobre un adjunto ya no reemplaza,
  // reemplazar/eliminar quedan detrás de este ⋮.
  readonly optionsMenuOpen = signal(false);
  readonly confirmingRemove = signal(false);
  // Imagen abierta en el visor full-screen (ver ImageViewer) — null cuando
  // está cerrado. PDF nunca pasa por acá, se abre con window.open().
  readonly viewerUrl = signal<string | null>(null);

  readonly isPdf = computed(() => {
    const contentType = this.pendingAttachment()?.contentType ?? this.existingContentType();
    return contentType === 'application/pdf';
  });
  readonly fileName = computed(() => this.pendingAttachment()?.fileName ?? null);

  constructor() {
    // Modo edición: resuelve la URL de descarga del adjunto ya guardado —
    // solo una vez por path (no se re-pide si no cambió), nunca bloquea el
    // resto del formulario si falla (adjunto roto/borrado por fuera).
    effect(() => {
      const path = this.existingPath();
      if (!path) {
        this.existingUrl.set(null);
        return;
      }
      this.attachmentsService
        .getDownloadUrl(path)
        .then((url) => this.existingUrl.set(url))
        .catch((error) => {
          console.error('Error al obtener la URL del adjunto', error);
          this.existingUrl.set(null);
        });
    });
  }

  openMenu(): void {
    if (this.compressing()) {
      return;
    }
    this.menuOpen.set(true);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  // Tap principal sobre un adjunto (pendiente o ya guardado) — ANTES
  // reemplazaba (abría el menú de fuente); ahora abre/previsualiza. Imagen
  // -> visor full-screen con zoom (ImageViewer); PDF -> @capacitor/browser
  // (Chrome Custom Tabs en Android), no window.open(): confirmado que
  // window.open() es poco confiable dentro del WebView nativo.
  async openAttachment(): Promise<void> {
    if (this.isPdf()) {
      // Browser.open() solo acepta http(s) — pasarle un blob: (un PDF
      // recién elegido, todavía sin subir) hace CRASHEAR la app en Android
      // (confirmado: Chrome Custom Tabs no resuelve blob:, es una limitación
      // de la API nativa, no un detalle de este plugin en particular). Por
      // eso acá SOLO se usa existingUrl() (ya subido, URL https real de
      // Storage) — un PDF pendiente simplemente no tiene cómo
      // previsualizarse todavía; se avisa en vez de no hacer nada.
      const url = this.existingUrl();
      if (!url) {
        this.errorMessage.set('Guarda primero para ver el PDF.');
        return;
      }
      try {
        await Browser.open({ url });
      } catch (error) {
        console.error('Error al abrir el PDF', error);
      }
      return;
    }
    const url = this.pendingPreviewUrl() ?? this.existingUrl();
    if (url) {
      this.viewerUrl.set(url);
    }
  }

  closeViewer(): void {
    this.viewerUrl.set(null);
  }

  openOptionsMenu(event: Event): void {
    event.stopPropagation();
    this.confirmingRemove.set(false);
    this.optionsMenuOpen.set(true);
  }

  closeOptionsMenu(): void {
    this.optionsMenuOpen.set(false);
    this.confirmingRemove.set(false);
  }

  replaceFromOptionsMenu(): void {
    this.closeOptionsMenu();
    this.openMenu();
  }

  // Pendiente (nunca se subió) — descartarlo es inmediato, sin confirmar:
  // no hay nada real que perder todavía (ver clear()).
  quitPending(): void {
    this.closeOptionsMenu();
    this.clear();
  }

  askRemoveExisting(): void {
    this.confirmingRemove.set(true);
  }

  cancelRemoveExisting(): void {
    this.confirmingRemove.set(false);
  }

  // Ya guardado en Storage — esto sí es destructivo de verdad, por eso pasa
  // por askRemoveExisting() primero (confirmar). Quien borra de verdad es
  // el padre (ver existingRemoved arriba); acá solo se avisa.
  confirmRemoveExisting(): void {
    this.closeOptionsMenu();
    this.existingRemoved.emit();
  }

  async takePhoto(): Promise<void> {
    this.closeMenu();
    try {
      const result = await Camera.takePhoto({ quality: 85 });
      await this.processMediaResult(result);
    } catch (error) {
      // Cancelar (botón atrás, back de la app de cámara) también rechaza la
      // promesa — no es un error real, no se le muestra nada al usuario.
      console.error('Camera.takePhoto() no produjo una foto', error);
    }
  }

  async pickFromGallery(): Promise<void> {
    this.closeMenu();
    try {
      const { results } = await Camera.chooseFromGallery({ mediaType: MediaTypeSelection.Photo, quality: 85 });
      const [result] = results;
      if (result) {
        await this.processMediaResult(result);
      }
    } catch (error) {
      console.error('Camera.chooseFromGallery() no produjo una foto', error);
    }
  }

  async pickPdf(): Promise<void> {
    this.closeMenu();
    try {
      const { files } = await FilePicker.pickFiles({ types: ['application/pdf'], limit: 1 });
      const [picked] = files;
      if (picked) {
        const file = await this.fileFromPickedFile(picked);
        await this.processFile(file);
      }
    } catch (error) {
      console.error('FilePicker.pickFiles() no produjo un archivo', error);
    }
  }

  clear(): void {
    this.revokePendingPreview();
    this.pendingAttachment.set(null);
    this.pendingPreviewUrl.set(null);
    this.errorMessage.set(null);
    this.attachmentReady.emit(null);
  }

  // MediaResult (takePhoto/chooseFromGallery) solo trae webPath, nunca un
  // nombre de archivo original — "foto.jpg" es puramente cosmético (ver
  // fileName()), el path real de Storage siempre es fijo (ver
  // MovementsService.attachFile()).
  private async processMediaResult(result: MediaResult): Promise<void> {
    if (!result.webPath) {
      return;
    }
    const blob = await (await fetch(result.webPath)).blob();
    const file = new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' });
    await this.processFile(file);
  }

  // PickedFile trae blob directo en Web; en Android/iOS hay que resolverlo
  // a partir de webPath (ver README del plugin: evitar su opción readData
  // para archivos grandes, por eso nunca se pide acá).
  private async fileFromPickedFile(picked: PickedFile): Promise<File> {
    if (picked.blob) {
      return new File([picked.blob], picked.name, { type: picked.mimeType });
    }
    const blob = await (await fetch(picked.webPath!)).blob();
    return new File([blob], picked.name, { type: blob.type || picked.mimeType });
  }

  private async processFile(file: File): Promise<void> {
    this.errorMessage.set(null);
    this.compressing.set(true);
    try {
      // En paralelo, no en secuencia — las dos parten del mismo File
      // original y ninguna depende de la otra. prepareForAi() nunca lanza
      // (ver attachment-compression.ts), así que un fallo ahí nunca es la
      // causa de que processFile() caiga al catch de abajo.
      const [{ blob, contentType }, aiPreview] = await Promise.all([
        this.attachmentsService.prepare(file),
        this.prepareAiPreview() ? this.attachmentsService.prepareForAi(file) : Promise.resolve(undefined),
      ]);
      this.revokePendingPreview();
      const pending: PendingAttachment = { blob, contentType, fileName: file.name, aiPreview };
      this.pendingAttachment.set(pending);
      this.pendingPreviewUrl.set(contentType.startsWith('image/') ? URL.createObjectURL(blob) : null);
      this.attachmentReady.emit(pending);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No pudimos procesar el archivo.');
    } finally {
      this.compressing.set(false);
    }
  }

  private revokePendingPreview(): void {
    const url = this.pendingPreviewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}
