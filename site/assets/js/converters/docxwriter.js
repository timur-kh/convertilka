// Минимальный генератор DOCX (Office Open XML) без библиотек: несколько XML-файлов в ZIP-архиве.
// Блоки: { type: 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'pagebreak', runs: [{ text, bold, italic }] }
import { vendorUrl } from '../util.js';

// В XML запрещены управляющие символы — убираем, иначе Word откажется открывать файл
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const xml = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/>';
const heading = (id, name, size) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading('Heading1', 'heading 1', 32)}
${heading('Heading2', 'heading 2', 28)}
${heading('Heading3', 'heading 3', 24)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

function runXml({ text, bold, italic, br }) {
  const pr = (bold ? '<w:b/>' : '') + (italic ? '<w:i/>' : '');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${br ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

function blockXml(b) {
  if (b.type === 'pagebreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const style = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', li: 'ListParagraph' }[b.type];
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/>${b.type === 'li' ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>` : '';
  return `<w:p>${pPr}${(b.runs || []).filter((r) => r.text || r.br).map(runXml).join('')}</w:p>`;
}

/** blocks → Blob .docx */
export async function buildDocx(blocks, { title = '' } = {}) {
  const { zipSync, strToU8 } = await import(vendorUrl('three/addons/libs/fflate.module.js'));
  const body = blocks.map(blockXml).join('\n');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
  const zip = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
    'docProps/core.xml': strToU8(core),
  });
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** Упрощённый HTML → блоки DOCX (для электронных книг и HTML): заголовки, абзацы, списки, жирный/курсив. */
export function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks = [];
  const runsOf = (node, style = {}) => {
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.data.replace(/\s+/g, ' ');
        if (t.trim() || (t && out.length)) out.push({ text: t, ...style });
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = n.tagName;
        if (tag === 'BR') out.push({ text: '\n', ...style });
        else out.push(...runsOf(n, { bold: style.bold || /^(B|STRONG)$/.test(tag), italic: style.italic || /^(I|EM|CITE)$/.test(tag) }));
      }
    }
    return out;
  };
  const walk = (node) => {
    for (const n of node.children) {
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) blocks.push({ type: `h${Math.min(3, Number(tag[1]))}`, runs: runsOf(n) });
      else if (tag === 'P' || (tag === 'BLOCKQUOTE' && !n.children.length)) blocks.push({ type: 'p', runs: runsOf(n) });
      else if (tag === 'LI') blocks.push({ type: 'li', runs: runsOf(n) });
      else if (tag === 'HR') blocks.push({ type: 'pagebreak' });
      else if (n.children.length) walk(n);
      else if (n.textContent.trim()) blocks.push({ type: 'p', runs: runsOf(n) });
    }
  };
  walk(doc.body);
  // Переносы строк внутри абзаца: делим на отдельные куски текста (в DOCX это отдельные run-ы)
  for (const b of blocks) {
    if (b.runs) b.runs = b.runs.flatMap((r) => r.text.split('\n').map((t, i) => (i ? { ...r, text: t, br: true } : { ...r, text: t })));
  }
  return blocks;
}
