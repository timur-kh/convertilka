// UI-сценарий для главной страницы: выполняется раннером внутри страницы
//   node tests/run-headless.mjs http://localhost:8080/ 10 tests/ui-scenario.js
(async () => {
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(100); } return false; };
  const report = [];
  const items = () => [...document.querySelectorAll('#file-list .item')];
  const panelText = () => $('#pp-body').innerText.replace(/\s+/g, ' ').trim();

  report.push(`до файлов: зона видна=${!$('#dropzone').hidden}, рабочее окно скрыто=${$('#workspace').hidden}`);

  const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  c.getContext('2d').fillRect(10, 10, 20, 20);
  const png = new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'фото.png', { type: 'image/png' });
  const md = new File(['# Привет\n\nТекст'], 'заметка.md');
  const step = new File([await (await fetch('/tests/fixtures/cube-10mm.stp')).blob()], 'esp box.STEP');
  const bad = new File(['x'], 'virus.exe');
  const dt = new DataTransfer();
  [png, md, step, bad].forEach((f) => dt.items.add(f));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));

  report.push('элементов в списке: ' + items().length + ' (ожидается 3)');
  report.push(`после добавления: зона скрыта=${$('#dropzone').hidden}, рабочее окно видно=${!$('#workspace').hidden}`);
  report.push('уведомление: ' + $('#toast').textContent);
  await until(() => $('#pp-body img.pv-image'));
  report.push('автопредпросмотр первого файла: ' + $('#pp-title').textContent + ', выбран: ' + items()[0].classList.contains('selected'));

  // 3D: размеры
  items()[2].querySelector('.item-name').click();
  await until(() => $('#pp-body .pv-dims, #pp-body .pv-error'), 30000);
  report.push('3D заголовок: ' + $('#pp-title').textContent + ', выбран: ' + items()[2].classList.contains('selected'));
  report.push('3D размеры: ' + ($('#pp-body .pv-error')?.textContent || [...document.querySelectorAll('.dim')].map((d) => d.innerText.replace(/\n/g, ': ')).join(' | ')));
  const canvas = $('#pp-body canvas');
  report.push(`3D холст: ${canvas?.clientWidth}×${canvas?.clientHeight}`);

  // Развернуть → холст стал больше → Esc сворачивает
  $('#pp-expand').click();
  await wait(400);
  report.push(`развёрнуто: ${$('#preview-panel').classList.contains('expanded')}, фон: ${!$('#pp-backdrop').hidden}, холст: ${canvas.clientWidth}×${canvas.clientHeight}`);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(300);
  report.push(`после Esc: развёрнуто=${$('#preview-panel').classList.contains('expanded')}, холст: ${canvas.clientWidth}×${canvas.clientHeight}`);

  // Конвертация и предпросмотр результата
  $('#convert-all').click();
  await until(() => items().every((i) => ['done', 'error'].includes(i.dataset.state)), 30000);
  for (const i of items()) report.push(`${i.querySelector('.item-name').textContent}: ${i.dataset.state} — ${i.querySelector('.item-status').textContent} — ${[...i.querySelectorAll('.outputs button')].map((b) => b.textContent).join(' | ')}`);
  items()[1].querySelector('.outputs .link-btn').click();
  await until(() => $('#pp-body iframe, #pp-body .pv-error'));
  report.push('результат: ' + $('#pp-title').textContent + ' — ' + ($('#pp-body iframe') ? `iframe sandbox="${$('#pp-body iframe').getAttribute('sandbox')}"` : panelText()));

  // Удаление показываемого файла — показывается соседний
  items()[1].querySelector('.item-remove').click();
  await wait(300);
  report.push('после удаления: показан ' + $('#pp-title').textContent + ', выбран=' + items()[1]?.classList.contains('selected'));
  // Клик по кнопке «Конвертировать» в строке не должен переключать предпросмотр
  items()[0].querySelector('.convert').click();
  await wait(300);
  report.push('клик по «Конвертировать» не меняет предпросмотр: ' + $('#pp-title').textContent);
  $('#clear-all').click();
  await wait(300);
  report.push(`после «Очистить»: зона видна=${!$('#dropzone').hidden}, рабочее окно скрыто=${$('#workspace').hidden}`);
  return report.join('\n');
})()
