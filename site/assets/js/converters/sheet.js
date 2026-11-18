// Таблицы: XLSX / XLS / ODS / CSV / JSON (SheetJS).
import { loadScript, readText, baseName, escapeHtml } from '../util.js';
import { wrapHtmlDocument } from '../sanitize.js';

const getXLSX = () => loadScript('xlsx/xlsx.full.min.js', 'XLSX');

export async function readWorkbook(file, from) {
  const XLSX = await getXLSX();
  if (from === 'csv') {
    // Текст декодируем сами: так правильно читаются CSV в Windows-1251 из русского Excel
    return XLSX.read(await readText(file), { type: 'string', raw: true });
  }
  if (from === 'json') {
    let data;
    try {
      data = JSON.parse(await readText(file));
    } catch {
      throw new Error('Файл не является корректным JSON');
    }
    const wb = XLSX.utils.book_new();
    const sheets = Array.isArray(data) ? { Лист1: data } : data;
    for (const [name, rows] of Object.entries(sheets || {})) {
      if (!Array.isArray(rows)) continue;
      const ws = Array.isArray(rows[0]) ? XLSX.utils.aoa_to_sheet(rows) : XLSX.utils.json_to_sheet(rows.map(flatten));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31) || 'Лист');
    }
    if (!wb.SheetNames.length) throw new Error('JSON должен быть массивом объектов (строки таблицы) или объектом { "Лист": [...] }');
    return wb;
  }
  return XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dense: true });
}

/** Вложенные объекты превращаем в колонки вида "a.b". */
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') return { value: obj };
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

/** opts.csvSeparator: ',' | ';' | '\t' */
export async function convert(file, from, to, opts = {}) {
  const XLSX = await getXLSX();
  const wb = await readWorkbook(file, from);
  const base = baseName(file.name);

  switch (to) {
    case 'xlsx':
    case 'ods': {
      const data = XLSX.write(wb, { bookType: to, type: 'array', compression: true });
      const mime = to === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.oasis.opendocument.spreadsheet';
      return [{ blob: new Blob([data], { type: mime }), name: `${base}.${to}` }];
    }
    case 'csv': {
      const FS = opts.csvSeparator || ',';
      const nonEmpty = wb.SheetNames.filter((n) => wb.Sheets[n]['!ref']);
      return nonEmpty.map((n) => ({
        // BOM нужен, чтобы Excel открыл UTF-8 с кириллицей без «кракозябр»
        blob: new Blob(['﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS, blankrows: false })], { type: 'text/csv;charset=utf-8' }),
        name: nonEmpty.length > 1 ? `${base} - ${n}.csv` : `${base}.csv`,
      }));
    }
    case 'json': {
      const sheets = {};
      for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
      const data = wb.SheetNames.length === 1 ? sheets[wb.SheetNames[0]] : sheets;
      return [{ blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name: `${base}.json` }];
    }
    case 'html': {
      const body = wb.SheetNames.map((n) => `<h2>${escapeHtml(n)}</h2>\n${sheetTable(XLSX, wb.Sheets[n])}`).join('\n');
      return [{ blob: new Blob([wrapHtmlDocument(base, body)], { type: 'text/html;charset=utf-8' }), name: `${base}.html` }];
    }
    default:
      throw new Error(`Неподдерживаемый формат: ${to}`);
  }
}

/** HTML-таблица из листа. Строим сами и экранируем каждую ячейку. */
export function sheetTable(XLSX, ws, maxRows = Infinity) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  const shown = rows.slice(0, maxRows);
  const html = shown.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('\n');
  const more = rows.length > shown.length ? `<p>… и ещё ${rows.length - shown.length} строк</p>` : '';
  return `<table>${html}</table>${more}`;
}

export { getXLSX };
