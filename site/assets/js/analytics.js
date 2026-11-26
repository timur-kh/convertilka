// Счётчики посещений: Яндекс.Метрика и (по желанию) Google Analytics 4.
// Номера счётчиков вписываются в tools/build-pages.mjs (ANALYTICS) — генератор кладёт их в
// <meta name="analytics" data-ym="…" data-ga="…"> и открывает нужные домены в Content-Security-Policy.
// Пока номеров нет, этот модуль ничего не загружает и никуда не обращается.
//
// Что уходит в счётчики: адрес и заголовок страницы, источник перехода и обезличенные события
// вида «конвертация png → jpg». Имена и содержимое файлов НЕ передаются никогда. Вебвизор выключен.

const meta = document.querySelector('meta[name="analytics"]');
const YM = meta?.dataset.ym ? Number(meta.dataset.ym) : 0;
const GA = meta?.dataset.ga || '';

function load(src) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.append(s);
}

if (YM) {
  // Стандартная «заглушка» Метрики: вызовы копятся в очереди, пока грузится tag.js
  window.ym = window.ym || function ym(...args) { (window.ym.a = window.ym.a || []).push(args); };
  window.ym.l = Date.now();
  load('https://mc.yandex.ru/metrika/tag.js');
  window.ym(YM, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
}

if (GA) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); }; // gtag ждёт именно arguments
  window.gtag('js', new Date());
  window.gtag('config', GA, { anonymize_ip: true });
  load(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA)}`);
}

/**
 * Событие («цель» в Метрике, event в GA): goal('convert', { from: 'png', to: 'jpg' }).
 * Параметры — только форматы и типы действий, никаких имён файлов.
 */
export function goal(name, params = {}) {
  try {
    if (YM && window.ym) window.ym(YM, 'reachGoal', name, params);
    if (GA && window.gtag) window.gtag('event', name, params);
  } catch { /* счётчик не загрузился (блокировщик рекламы) — это нормально */ }
}
