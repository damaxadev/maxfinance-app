// Tope por archivo YA comprimido (ver DATABASE.md / "Adjuntos") — dentro
// del rango 3-5MB pedido, deja margen para fotos de recibos con bastante
// detalle sin acercarse al límite real de Cloud Storage/Functions.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export type AttachmentKind = 'image' | 'pdf';

// Único tipo aceptado — cualquier otro (video, Word, etc.) se rechaza acá
// antes de intentar subir nada.
export function classifyAttachment(mimeType: string): AttachmentKind {
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  throw new Error('Solo se aceptan imágenes o archivos PDF.');
}

export interface CompressionAttempt {
  quality: number;
  maxDimension: number;
}

export const INITIAL_COMPRESSION_ATTEMPT: CompressionAttempt = { quality: 0.8, maxDimension: 1600 };

const MIN_QUALITY = 0.4;
const MIN_DIMENSION = 800;

// Pura — sin tocar canvas/Image, para poder probar el algoritmo de
// compresión sin depender de un contexto 2D real (jsdom no lo implementa,
// ver attachment-compression.spec.ts). Primero baja la calidad JPEG hasta
// un piso, luego reduce la dimensión máxima — null cuando ya no queda
// margen (se acepta el último resultado tal como quedó, aunque siga sobre
// el tope: preferible a un archivo irreconociblemente pequeño).
export function nextCompressionAttempt(previous: CompressionAttempt): CompressionAttempt | null {
  if (previous.quality > MIN_QUALITY) {
    return { ...previous, quality: Math.round((previous.quality - 0.1) * 10) / 10 };
  }
  if (previous.maxDimension > MIN_DIMENSION) {
    return { ...previous, maxDimension: Math.round(previous.maxDimension * 0.8) };
  }
  return null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No pudimos leer la imagen.'));
    };
    image.src = url;
  });
}

function encodeAttempt(image: HTMLImageElement, attempt: CompressionAttempt): Promise<Blob> {
  const scale = Math.min(1, attempt.maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.reject(new Error('No pudimos procesar la imagen.'));
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No pudimos procesar la imagen.'))),
      'image/jpeg',
      attempt.quality
    );
  });
}

// Comprime reintentando con nextCompressionAttempt() hasta caer bajo
// maxBytes o quedarse sin margen — nunca lanza por "sigue pesando
// demasiado": siempre devuelve el mejor resultado que logró.
export async function compressImage(file: File, maxBytes: number = MAX_ATTACHMENT_BYTES): Promise<Blob> {
  const image = await loadImage(file);
  let attempt: CompressionAttempt | null = INITIAL_COMPRESSION_ATTEMPT;
  let blob = await encodeAttempt(image, attempt);

  while (blob.size > maxBytes) {
    attempt = nextCompressionAttempt(attempt);
    if (!attempt) {
      break;
    }
    blob = await encodeAttempt(image, attempt);
  }

  return blob;
}

export interface PreparedAttachment {
  blob: Blob;
  contentType: string;
}

// Copia de mayor calidad para la lectura automática por IA (ver
// ReceiptReader) — NUNCA se persiste, solo viaja al Worker. A diferencia de
// compressImage() (tope duro de MAX_ATTACHMENT_BYTES, iterativo, para
// Storage), esto es una sola pasada a calidad fija: 1568px/0.9 es lo que
// Anthropic recomienda para sus modelos de visión (evita que la API misma
// la reescale, lo que solo agrega latencia sin mejorar la lectura) — ver
// https://docs.claude.com/en/docs/build-with-claude/vision. A esa
// resolución y calidad, una foto de recibo nunca se acerca al tope de 10MB
// (base64) que documenta Anthropic por imagen, así que no hace falta
// reintentar como sí hace compressImage().
const AI_PREVIEW_ATTEMPT: CompressionAttempt = { quality: 0.9, maxDimension: 1568 };

export interface AiPreview {
  base64: string;
  mediaType: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('No pudimos leer el archivo.'));
    reader.readAsDataURL(blob);
  });
}

// Punto de entrada para AttachmentPicker cuando prepareAiPreview() está
// activo (hoy solo MovementForm) — PDF se manda tal cual en base64 (Claude
// lo procesa nativo, no hace falta rasterizar ninguna página, ver
// https://docs.claude.com/en/docs/build-with-claude/pdf-support); imagen
// pasa por el encode de calidad alta de arriba. Nunca lanza: si algo falla
// acá, AttachmentPicker simplemente no manda aiPreview y el formulario cae
// a entrada manual sin bloquear el adjunto real.
export async function prepareForAi(file: File): Promise<AiPreview | null> {
  try {
    const kind = classifyAttachment(file.type);
    if (kind === 'pdf') {
      return { base64: await blobToBase64(file), mediaType: 'application/pdf' };
    }
    const image = await loadImage(file);
    const blob = await encodeAttempt(image, AI_PREVIEW_ATTEMPT);
    return { base64: await blobToBase64(blob), mediaType: 'image/jpeg' };
  } catch (error) {
    console.error('No pudimos preparar la copia para la lectura automática', error);
    return null;
  }
}

// Punto de entrada único desde el picker (ver AttachmentPicker) — PDF sin
// compresión (solo valida el tope de tamaño); imagen siempre comprimida,
// re-codificada a JPEG sin importar el formato original.
export async function prepareAttachment(file: File, maxBytes: number = MAX_ATTACHMENT_BYTES): Promise<PreparedAttachment> {
  const kind = classifyAttachment(file.type);

  if (kind === 'pdf') {
    if (file.size > maxBytes) {
      throw new Error(`El PDF no puede superar ${Math.round(maxBytes / (1024 * 1024))}MB.`);
    }
    return { blob: file, contentType: file.type };
  }

  const blob = await compressImage(file, maxBytes);
  return { blob, contentType: 'image/jpeg' };
}
