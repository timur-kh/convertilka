// Web Worker: чтение DjVu (библиотека DjVu.js, GPL-2.0) в отдельном потоке —
// расшифровка страниц сканов тяжёлая и не должна подвешивать страницу.
// Сообщения: { id, cmd: 'open', buffer } → { pages, sizes }
//            { id, cmd: 'page', n, text } → { width, height, dpi, data (RGBA), text? }
import DjVuDocument from '../../../vendor/djvujs/DjVuDocument.js';

let doc = null;

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  try {
    if (cmd === 'open') {
      doc = new DjVuDocument(data.buffer);
      if (!doc.isBundled()) {
        throw new Error('Это многофайловый (indirect) DjVu: страницы лежат в отдельных файлах. Откройте его в DjView и сохраните как «Bundled DjVu», затем добавьте сюда.');
      }
      self.postMessage({ id, ok: true, pages: doc.getPagesQuantity(), sizes: doc.getPagesSizes() });
    } else if (cmd === 'page') {
      if (!doc) throw new Error('Документ не открыт');
      const page = await doc.getPage(data.n);
      const img = page.getImageData();
      const text = data.text ? page.getText() || '' : undefined;
      const msg = { id, ok: true, width: img.width, height: img.height, dpi: page.getDpi(), data: img.data.buffer, text };
      page.reset?.(); // освобождаем память декодированной страницы
      self.postMessage(msg, [img.data.buffer]);
    } else if (cmd === 'text') {
      const page = await doc.getPage(data.n);
      const text = page.getText() || '';
      page.reset?.();
      self.postMessage({ id, ok: true, text });
    }
  } catch (e) {
    const msg = e?.message || e?.code || String(e);
    self.postMessage({ id, ok: false, error: /indirect|многофайл/i.test(msg) ? msg : `Не удалось прочитать DjVu: ${msg}` });
  }
};
