import { Injectable, inject } from '@angular/core';
import { Storage, deleteObject, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';

import { prepareAttachment, prepareForAi, type AiPreview, type PreparedAttachment } from './attachment-compression';

// Capa delgada sobre Cloud Storage — MovementsService/GoalEntriesService
// la usan desde su propio attachFile() (ver esos archivos), nunca se llama
// directo desde un formulario: igual que Firestore, el acceso a Storage
// queda encapsulado en los servicios de cada colección.
@Injectable({
  providedIn: 'root',
})
export class AttachmentsService {
  private readonly storage = inject(Storage);

  // Envuelve la función pura prepareAttachment() (ver attachment-compression.ts)
  // detrás de un método inyectable — AttachmentPicker lo llama así, no la
  // función directo, para poder sustituirlo en tests vía TestBed (el
  // sistema de tests de Angular no permite vi.mock sobre imports
  // relativos, ver attachment-picker.spec.ts).
  async prepare(file: File): Promise<PreparedAttachment> {
    return prepareAttachment(file);
  }

  // Mismo motivo que prepare(): envuelve la función pura prepareForAi() para
  // poder sustituirla en tests vía TestBed.
  async prepareForAi(file: File): Promise<AiPreview | null> {
    return prepareForAi(file);
  }

  async upload(path: string, blob: Blob, contentType: string): Promise<void> {
    await uploadBytes(ref(this.storage, path), blob, { contentType });
  }

  async getDownloadUrl(path: string): Promise<string> {
    return getDownloadURL(ref(this.storage, path));
  }

  // Best-effort — se usa al eliminar el documento dueño del adjunto; que
  // nunca haya existido un archivo ahí (object-not-found) no debe impedir
  // borrar el documento.
  async remove(path: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, path));
    } catch (error) {
      console.error('Error al eliminar el adjunto', error);
    }
  }
}
