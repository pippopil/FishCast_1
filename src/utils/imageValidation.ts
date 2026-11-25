export const MAX_PHOTO_RAW_BYTES = 12 * 1024 * 1024; // 12 МБ для исходного фото с камеры смартфона
export const MAX_PHOTO_FINAL_BYTES = 5 * 1024 * 1024; // 5 МБ итоговый предел хранения/отправки
export const MAX_PHOTO_DIMENSION_PX = 1280;
export const MIN_PHOTO_DIMENSION_PX = 32;

export const ALLOWED_PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ValidatedPhotoResult {
  ok: true;
  dataUrl: string;
  sizeBytes: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  compressed: boolean;
}

export interface ValidatedPhotoError {
  ok: false;
  error: string;
}

export type PhotoValidationOutcome = ValidatedPhotoResult | ValidatedPhotoError;

function inferMimeFromFilename(name?: string): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

export function validatePhotoFileMeta(file: {
  name?: string;
  size: number;
  type: string;
}): { ok: true; normalizedMime: 'image/jpeg' | 'image/png' | 'image/webp' } | { ok: false; error: string } {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    return { ok: false, error: 'Файл изображения пуст или повреждён.' };
  }

  if (file.size > MAX_PHOTO_RAW_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `Файл слишком большой (${mb} МБ). Максимальный размер исходного фото — 12 МБ.`,
    };
  }

  const rawType = (file.type || '').toLowerCase().trim();
  const normalizedType = rawType === 'image/jpg' ? 'image/jpeg' : rawType;

  if (normalizedType && ALLOWED_PHOTO_MIMES.has(normalizedType)) {
    return { ok: true, normalizedMime: normalizedType as 'image/jpeg' | 'image/png' | 'image/webp' };
  }

  // Some mobile camera pickers return an empty MIME type; check file extension as fallback
  if (!normalizedType) {
    const byExt = inferMimeFromFilename(file.name);
    if (byExt) {
      return { ok: true, normalizedMime: byExt };
    }
  }

  if (normalizedType === 'image/heic' || normalizedType === 'image/heif') {
    return {
      ok: false,
      error: 'Формат HEIC не поддерживается браузером. Выберите JPEG, PNG или WebP (или включите JPEG в настройках камеры).',
    };
  }

  return {
    ok: false,
    error: 'Неподдерживаемый формат файла. Допускаются только изображения JPEG, PNG и WebP.',
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Файл повреждён или не является корректным изображением.'));
    img.src = src;
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return dataUrl.length;
  const base64Len = dataUrl.length - commaIdx - 1;
  return Math.floor((base64Len * 3) / 4);
}

/**
 * Validates file type, size, and decodable image dimensions; automatically compresses
 * high-resolution phone camera captures to <= 1280px JPEG so they store cleanly offline
 * in IndexedDB and sync reliably to the backend.
 */
export async function processAndValidateDiaryPhoto(file: File): Promise<PhotoValidationOutcome> {
  const meta = validatePhotoFileMeta(file);
  if (!meta.ok) {
    return meta;
  }

  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    if (!rawDataUrl.startsWith('data:image/')) {
      return { ok: false, error: 'Некорректное содержимое файла изображения.' };
    }

    const img = await loadImageElement(rawDataUrl);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;

    if (naturalW < MIN_PHOTO_DIMENSION_PX || naturalH < MIN_PHOTO_DIMENSION_PX) {
      return {
        ok: false,
        error: `Слишком маленькое изображение (${naturalW}×${naturalH} пикс.). Минимум — ${MIN_PHOTO_DIMENSION_PX}×${MIN_PHOTO_DIMENSION_PX}.`,
      };
    }

    const needsResize =
      naturalW > MAX_PHOTO_DIMENSION_PX ||
      naturalH > MAX_PHOTO_DIMENSION_PX ||
      file.size > 900 * 1024;

    if (!needsResize && file.size <= MAX_PHOTO_FINAL_BYTES) {
      return {
        ok: true,
        dataUrl: rawDataUrl,
        sizeBytes: file.size,
        mime: meta.normalizedMime,
        width: naturalW,
        height: naturalH,
        compressed: false,
      };
    }

    // Downscale / re-encode via Canvas for camera photos
    const scale = Math.min(1, MAX_PHOTO_DIMENSION_PX / Math.max(naturalW, naturalH));
    const targetW = Math.max(MIN_PHOTO_DIMENSION_PX, Math.round(naturalW * scale));
    const targetH = Math.max(MIN_PHOTO_DIMENSION_PX, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (file.size <= MAX_PHOTO_FINAL_BYTES) {
        return {
          ok: true,
          dataUrl: rawDataUrl,
          sizeBytes: file.size,
          mime: meta.normalizedMime,
          width: naturalW,
          height: naturalH,
          compressed: false,
        };
      }
      return { ok: false, error: 'Не удалось сжать изображение. Выберите фото до 5 МБ.' };
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outMime: 'image/jpeg' | 'image/webp' =
      meta.normalizedMime === 'image/webp' ? 'image/webp' : 'image/jpeg';
    let compressedUrl = canvas.toDataURL(outMime, 0.82);
    let compressedBytes = estimateDataUrlBytes(compressedUrl);

    if (compressedBytes > MAX_PHOTO_FINAL_BYTES) {
      compressedUrl = canvas.toDataURL('image/jpeg', 0.65);
      compressedBytes = estimateDataUrlBytes(compressedUrl);
    }

    if (compressedBytes > MAX_PHOTO_FINAL_BYTES) {
      return {
        ok: false,
        error: 'Даже после сжатия фото превышает 5 МБ. Попробуйте сделать снимок с меньшим разрешением.',
      };
    }

    return {
      ok: true,
      dataUrl: compressedUrl,
      sizeBytes: compressedBytes,
      mime: compressedUrl.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg',
      width: targetW,
      height: targetH,
      compressed: true,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Ошибка проверки изображения. Выберите другой файл.',
    };
  }
}

export function formatPhotoSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
