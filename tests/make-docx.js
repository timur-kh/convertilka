// Тестовый DOCX «как из Google Docs/LibreOffice»: A4, поля 2 см, колонтитулы, таблица с границами,
// жирный/курсив, Calibri и Times New Roman, длинный текст без меток разбиения на страницы.
export async function makeTestDocx(fflate, { paragraphs = 40, wordMarkers = false } = {}) {
  const { zipSync, strToU8 } = fflate;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const run = (t, { b, i, font } = {}) => `<w:r><w:rPr>${font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>` : ''}${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const para = (runs, { style, align } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runs}</w:p>`;
  const lorem = 'Настоящий договор определяет порядок оказания услуг по разработке программного обеспечения, сроки выполнения работ, порядок их приёмки и оплаты, а также ответственность сторон за неисполнение обязательств.';
  let body = para(run('Договор оказания услуг № 17', { b: true }), { style: 'Heading1' });
  body += para(run('Москва, 18 ноября 2026 г.', { i: true }), { align: 'right' });
  const cell = (t, w) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(run(t))}</w:tc>`;
  body += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6000"/></w:tblGrid>`
    + [['Исполнитель', 'ООО «Ромашка»'], ['Заказчик', 'ИП Иванов И. И.'], ['Сумма', '150 000 ₽']].map(([a, b]) => `<w:tr>${cell(a, 3000)}${cell(b, 6000)}</w:tr>`).join('') + '</w:tbl>';
  for (let i = 1; i <= paragraphs; i++) {
    body += para(run(`${i}. `, { b: true }) + run(lorem) + run(' Пункт выделен курсивом.', { i: true }) + (i % 5 === 0 ? run(' Times New Roman здесь.', { font: 'Times New Roman' }) : ''), { align: 'both' });
    if (wordMarkers && i % 12 === 0) body += '<w:p><w:r><w:lastRenderedPageBreak/></w:r></w:p>';
  }
  body += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` + para(run('Приложение 1 — после принудительного разрыва страницы', { b: true }), { style: 'Heading1' });
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2F5496"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`;
  const hdr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${ns}>${para(run('ООО «Ромашка» — Договор № 17', { i: true }), { align: 'right' })}</w:hdr>`;
  const ftr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${ns}>${para(run('Конфиденциально'), { align: 'center' })}</w:ftr>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
    'word/header1.xml': strToU8(hdr),
    'word/footer1.xml': strToU8(ftr),
  };
  return new File([zipSync(files)], 'договор.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
