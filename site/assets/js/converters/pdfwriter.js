// Минимальный генератор PDF: каждая страница — одна JPEG-картинка (без перекодирования, фильтр DCTDecode).

const LONG_SIDE_PT = 842; // длинная сторона страницы = длинная сторона A4

/** pages: [{ width, height, jpeg: Uint8Array }] → Blob application/pdf */
export function buildImagesPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const obj = (id, body) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n`);
    for (const part of body) push(part);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // бинарный маркер: «%âãÏÓ»

  const n = pages.length;
  // 1 — каталог, 2 — дерево страниц, далее по 3 объекта на страницу: страница, содержимое, картинка
  const pageId = (i) => 3 + i * 3;
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`]);

  pages.forEach((p, i) => {
    const k = LONG_SIDE_PT / Math.max(p.width, p.height);
    const pw = +(p.width * k).toFixed(2);
    const ph = +(p.height * k).toFixed(2);
    const id = pageId(i);
    obj(id, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`]);
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(id + 1, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    obj(id + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
  });

  const total = 3 + n * 3;
  const xref = pos;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
