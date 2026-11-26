// Иллюстрации к статьям Wiki — встроенный SVG (никаких внешних файлов; цвета — из CSS-переменных сайта,
// поэтому картинки сами подстраиваются под тёмную тему).

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Что нарисовано внутри «файла» — по типу содержимого. Координаты — в листе 160×200.
const GLYPHS = {
  image: `<rect x="40" y="52" width="80" height="62" rx="6" style="fill:var(--surface-2)"/>
    <circle cx="98" cy="70" r="8" style="fill:var(--g)" opacity=".55"/>
    <path d="M44 110 L66 80 L82 98 L94 86 L116 110 Z" style="fill:var(--g)" opacity=".85"/>`,
  document: `<rect x="42" y="50" width="60" height="7" rx="3.5" style="fill:var(--g)"/>
    ${[66, 78, 90, 102].map((y, i) => `<rect x="42" y="${y}" width="${[76, 70, 76, 48][i]}" height="5" rx="2.5" style="fill:var(--muted)" opacity=".45"/>`).join('')}`,
  sheet: `<rect x="40" y="50" width="80" height="62" rx="4" style="fill:none;stroke:var(--muted)" stroke-width="2" opacity=".55"/>
    <rect x="40" y="50" width="80" height="14" rx="4" style="fill:var(--g)" opacity=".8"/>
    ${[80, 96].map((y) => `<path d="M40 ${y} H120" style="stroke:var(--muted)" stroke-width="2" opacity=".45"/>`).join('')}
    ${[66, 93].map((x) => `<path d="M${x} 50 V112" style="stroke:var(--muted)" stroke-width="2" opacity=".45"/>`).join('')}`,
  model: `<g style="stroke:var(--g)" stroke-width="3" stroke-linejoin="round" fill="none">
      <path d="M80 46 L114 64 L114 100 L80 118 L46 100 L46 64 Z" style="fill:var(--g)" fill-opacity=".1"/>
      <path d="M46 64 L80 82 L114 64 M80 82 V118"/>
    </g>`,
  video: `<rect x="38" y="52" width="84" height="58" rx="8" style="fill:var(--g)" opacity=".9"/>
    ${[44, 58, 72, 86, 100, 114].map((x) => `<rect x="${x - 3}" y="56" width="6" height="5" rx="1" style="fill:var(--surface)" opacity=".7"/><rect x="${x - 3}" y="101" width="6" height="5" rx="1" style="fill:var(--surface)" opacity=".7"/>`).join('')}
    <path d="M73 70 L92 81 L73 92 Z" style="fill:var(--surface)"/>`,
  audio: `${[12, 26, 40, 22, 50, 34, 18, 44, 28, 14].map((h, i) => `<rect x="${41 + i * 8}" y="${81 - h / 2}" width="5" height="${h}" rx="2.5" style="fill:var(--g)" opacity="${0.55 + (i % 3) * 0.15}"/>`).join('')}`,
};

/** Обложка статьи: «файл» с загнутым уголком, содержимым по типу и расширением на ленте. */
export function coverSvg(ext, group, label) {
  const glyph = GLYPHS[group] || GLYPHS.document;
  const text = `.${ext.toUpperCase()}`;
  const fs = text.length > 5 ? 20 : 24;
  return `<figure class="fa-cover" style="--g:var(--g-${group})">
  <svg viewBox="0 0 160 200" role="img" aria-label="${esc(label)}">
    <path d="M28 10 H106 L136 40 V182 a8 8 0 0 1 -8 8 H28 a8 8 0 0 1 -8 -8 V18 a8 8 0 0 1 8 -8 Z" style="fill:var(--surface);stroke:var(--g)" stroke-width="3"/>
    <path d="M106 10 V32 a8 8 0 0 0 8 8 H136" style="fill:var(--surface-2);stroke:var(--g)" stroke-width="3" stroke-linejoin="round"/>
    ${glyph}
    <rect x="8" y="132" width="122" height="38" rx="9" style="fill:var(--g)"/>
    <text x="69" y="158" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="${fs}" fill="#fff">${esc(text)}</text>
  </svg>
</figure>`;
}

// Типичные размеры одного и того же содержимого в разных форматах (оценки, согласованы с текстами статей)
const SIZE_CHARTS = {
  image: {
    title: 'Сколько весит одна и та же фотография',
    note: 'Снимок 12 Мп (4000×3000), примерные значения: для JPG — качество 90%, для HEIC, WebP и AVIF — сопоставимое на глаз качество.',
    unit: 'МБ',
    rows: [
      { keys: ['bmp', 'tiff'], label: 'BMP, TIFF без сжатия', v: 36 },
      { keys: ['png'], label: 'PNG (без потерь)', v: 12 },
      { keys: ['jpg'], label: 'JPG', v: 3 },
      { keys: ['webp'], label: 'WebP', v: 2.1 },
      { keys: ['heic'], label: 'HEIC', v: 1.6 },
      { keys: ['avif'], label: 'AVIF', v: 1.5 },
    ],
  },
  audio: {
    title: 'Сколько весит минута стереозвука',
    note: '44,1 кГц, 2 канала; для форматов со сжатием указан битрейт. Размер FLAC зависит от музыки: обычно 50–70% от WAV.',
    unit: 'МБ',
    rows: [
      { keys: ['wav', 'aiff'], label: 'WAV, AIFF (без сжатия)', v: 10.1 },
      { keys: ['flac'], label: 'FLAC (без потерь)', v: 5.5 },
      { keys: ['mp3'], label: 'MP3, 320 кбит/с', v: 2.3 },
      { keys: ['mp3'], label: 'MP3, 192 кбит/с', v: 1.4 },
      { keys: ['m4a', 'aac', 'ogg', 'wma'], label: 'AAC, Vorbis, WMA, 128 кбит/с', v: 0.94 },
      { keys: ['opus'], label: 'Opus, 96 кбит/с', v: 0.7 },
      { keys: ['amr'], label: 'AMR (голос), 12,2 кбит/с', v: 0.09 },
    ],
  },
};
// Где показывать диаграммы
const CHART_GROUPS = new Set(['image', 'audio']);
export const hasSizeChart = (key, group) => CHART_GROUPS.has(group) && SIZE_CHARTS[group]?.rows.some((r) => r.keys.includes(key));

const num = (v) => (v >= 10 ? String(Math.round(v)) : String(v).replace('.', ','));

/** Горизонтальная столбчатая диаграмма размеров; текущий формат выделен цветом акцента, остальные — серые. */
export function sizeChart(key, group) {
  const c = SIZE_CHARTS[group];
  if (!c || !hasSizeChart(key, group)) return '';
  const max = Math.max(...c.rows.map((r) => r.v));
  const rows = c.rows.map((r) => {
    const cur = r.keys.includes(key);
    const pct = Math.max(0.6, (r.v / max) * 100);
    const value = `≈ ${num(r.v)} ${c.unit}`;
    return `<li class="sc-row${cur ? ' is-current' : ''}" title="${esc(r.label)}: ${value}">
        <span class="sc-label">${esc(r.label)}</span>
        <span class="sc-track"><span class="sc-bar" style="width:${pct.toFixed(1)}%"></span><span class="sc-val">${value}</span></span>
      </li>`;
  }).join('');
  return `<figure class="size-chart">
    <figcaption><b>${esc(c.title)}</b></figcaption>
    <ul class="sc-list">${rows}</ul>
    <p class="sc-note">${esc(c.note)}</p>
  </figure>`;
}
