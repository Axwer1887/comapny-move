interface PdfJpeg {
  jpeg: Uint8Array;
  pixelW: number;
  pixelH: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function pad10(n: number): string {
  return String(n).padStart(10, '0');
}

/**
 * Embed a JPEG on a single PDF page. Binary image bytes are written as-is
 * (never through TextEncoder), and the XObject width/height are the pixel
 * dimensions of the JPEG — the cm operator does the page placement.
 */
export function buildPdf(image: PdfJpeg, pageW: number, pageH: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let pos = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encode(data) : data;
    parts.push(bytes);
    pos += bytes.length;
  };

  const offsets: number[] = [0, 0, 0, 0, 0, 0];

  push('%PDF-1.4\n');

  offsets[1] = pos;
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = pos;
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets[3] = pos;
  push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      `${Math.round(pageW)} ${Math.round(pageH)}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  offsets[4] = pos;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.pixelW} /Height ${image.pixelH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`,
  );
  push(image.jpeg);
  push('\nendstream\nendobj\n');

  const content =
    `q\n${image.w.toFixed(2)} 0 0 ${image.h.toFixed(2)} ${image.x.toFixed(2)} ${image.y.toFixed(2)} cm\n/Im1 Do\nQ\n`;
  const contentBytes = encode(content);
  offsets[5] = pos;
  push(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  push('endstream\nendobj\n');

  const xrefStart = pos;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${pad10(offsets[i])} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
