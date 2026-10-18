/**
 * PDF → image for map sketches. pdf.js (Mozilla, Apache-2.0) is loaded only
 * when a PDF is actually imported, so it does not slow down app start-up.
 * The legacy build is used for wider browser support.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

export const PDF_MAX_BYTES = 40 * 1024 * 1024;

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/**
 * Render one page (1-based) onto a white background.
 * `maxSide` limits the longer edge in pixels; vector drawings stay sharp
 * because pdf.js rasterises at the requested size.
 */
export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageNo: number,
  maxSide: number,
  type: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<string> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(6, maxSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas.toDataURL(type, 0.9);
}
