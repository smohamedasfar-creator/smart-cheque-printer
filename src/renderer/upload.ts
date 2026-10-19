import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { applyTransform, detectCheque, type DetectionResult } from '../shared/detect/detectCheque';
import { readImageDpi } from '../shared/detect/dpi';
import type { Raster } from '../shared/detect/imaging';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** PDFs are rendered at this resolution, so their size in millimetres is exact. */
const PDF_DPI = 300;
const PDF_POINTS_PER_INCH = 72;

export interface LoadedUpload {
  image: Raster;
  dpi: number | null;
}

function canvasRaster(canvas: HTMLCanvasElement): Raster {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, channels: 4, data };
}

async function loadPdf(bytes: Uint8Array): Promise<LoadedUpload> {
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: PDF_DPI / PDF_POINTS_PER_INCH });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return { image: canvasRaster(canvas), dpi: PDF_DPI };
  } finally {
    await task.destroy();
  }
}

async function loadImage(file: File, bytes: Uint8Array): Promise<LoadedUpload> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { image: canvasRaster(canvas), dpi: readImageDpi(bytes) };
}

const LOAD_TIMEOUT_MS = 60_000;

export async function loadUpload(file: File): Promise<LoadedUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const loading = isPdf ? loadPdf(bytes) : loadImage(file, bytes);
  // Never leave the user waiting forever on a damaged or unusual file.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('reading the file took too long. Try again, or save the scan as JPG or PDF from your scanner app.')), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([loading, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs detection after letting the browser paint (detection blocks for about a second on a full A4 scan). */
export function detectAsync(upload: LoadedUpload, flip?: boolean): Promise<DetectionResult> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(detectCheque({ image: upload.image, dpi: upload.dpi, flip }));
      } catch (err) {
        reject(err);
      }
    }, 30),
  );
}

/** The straightened, cropped cheque as a JPEG data URL, for the preview background. */
export function chequeImageDataUrl(upload: LoadedUpload, result: DetectionResult): string {
  const upright = applyTransform(upload.image, result.transform);
  const canvas = document.createElement('canvas');
  canvas.width = upright.width;
  canvas.height = upright.height;
  const data = new ImageData(new Uint8ClampedArray(upright.data), upright.width, upright.height);
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}
