// Страница «Поддержать»: ссылки на пожертвования и активация кода «без рекламы».
import { CONFIG } from './config.js';
import { h } from './util.js';
import { activate, deactivate, status } from './supporter.js';

const $ = (s) => document.querySelector(s);
const { donate } = CONFIG;

$('#ad-free-days').textContent = donate.adFreeDays;

const links = [
  ['Boosty', donate.boosty],
  ['Ko-fi', donate.kofi],
  ['Пожертвовать', donate.other],
].filter(([, url]) => /^https:\/\//.test(url || ''));
$('#donate-links').replaceChildren(
  ...links.map(([label, url]) => h('a', { class: 'btn btn-donate', href: url, target: '_blank', rel: 'noopener noreferrer' }, `♥ ${label}`)),
);
$('#donate-empty').hidden = links.length > 0;
if (donate.contactEmail) {
  const c = $('#contact');
  c.hidden = false;
  c.append('Код не пришёл или есть вопросы? Напишите: ', h('span', { class: 'mono' }, donate.contactEmail));
}

const box = $('#code-status');
const removeBtn = $('#code-remove');
function show(text, kind) {
  box.hidden = false;
  box.dataset.kind = kind;
  box.textContent = text;
}

async function refresh() {
  const s = await status();
  removeBtn.hidden = !s.active;
  if (s.active) show(`✓ Реклама отключена до ${s.expires.toLocaleDateString('ru')}. Спасибо за поддержку!`, 'ok');
  else if (s.expired) show('Срок действия кода закончился. Спасибо, что поддерживали проект!', 'info');
  else box.hidden = true;
}

$('#code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await activate($('#code-input').value);
  if (res.ok) {
    $('#code-input').value = '';
    await refresh();
  } else {
    show(res.reason, 'error');
  }
});
removeBtn.addEventListener('click', () => {
  deactivate();
  refresh();
});

refresh();
