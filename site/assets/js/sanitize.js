// Очистка HTML из пользовательских файлов (DOCX, Markdown, HTML, таблицы) перед показом и экспортом.
import { vendorUrl, escapeHtml } from './util.js';

let purifier;
async function getPurify() {
  if (!purifier) {
    const mod = await import(vendorUrl('dompurify/purify.es.mjs'));
    purifier = mod.default;
    // Внешние ссылки открываются без доступа к нашей странице
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('rel', 'noopener noreferrer nofollow');
        node.setAttribute('target', '_blank');
      }
      // Картинки только встроенные: никаких запросов на сторонние серверы (трекинг-пиксели и т.п.)
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (!/^(data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);|blob:)/i.test(src)) node.removeAttribute('src');
      }
    });
  }
  return purifier;
}

/** Возвращает безопасный фрагмент HTML: без скриптов, обработчиков, форм, iframe и внешних ресурсов. */
export async function sanitizeHtml(html) {
  const p = await getPurify();
  return p.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'srcset'],
  });
}

const DOC_CSS = `
  body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1b1f24;background:#fff}
  img{max-width:100%;height:auto}
  table{border-collapse:collapse;max-width:100%}
  td,th{border:1px solid #ccd;padding:4px 8px;vertical-align:top}
  pre,code{font-family:ui-monospace,Consolas,monospace;background:#f3f4f6;border-radius:4px}
  pre{padding:.75rem;overflow:auto;white-space:pre-wrap}
  blockquote{border-left:3px solid #ccd;margin-left:0;padding-left:1rem;color:#555}
`;

/** Полный HTML-документ для сохранения в файл. bodyHtml уже должен быть очищен. */
export function wrapHtmlDocument(title, bodyHtml) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

/** Документ для предпросмотра внутри изолированного iframe (sandbox без скриптов). */
export function previewDocument(bodyHtml, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOC_CSS}body{margin:1rem auto}${extraCss}</style></head><body>${bodyHtml}</body></html>`;
}
