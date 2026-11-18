// Рекламные блоки. Скрипт рекламной сети подключается, только если:
//   1) реклама включена в config.js, 2) у посетителя нет активного кода «без рекламы».
// Места под рекламу размечены в HTML как <div class="ad-slot" data-slot="top|side|bottom">.
import { CONFIG } from './config.js';
import { status } from './supporter.js';

function injectScript(src, attrs = {}) {
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.append(s);
}

function setupYandex(slots) {
  const ids = CONFIG.ads.yandex.blocks;
  window.yaContextCb = window.yaContextCb || [];
  injectScript('https://yandex.ru/ads/system/context.js');
  slots.forEach((slot, i) => {
    const blockId = ids[slot.dataset.slot];
    if (!blockId) return slot.remove();
    const id = `yandex_rtb_${blockId}_${i}`;
    const box = document.createElement('div');
    box.id = id;
    slot.append(box);
    window.yaContextCb.push(() => window.Ya?.Context?.AdvManager?.render({ blockId, renderTo: id }));
  });
}

function setupAdsense(slots) {
  const { client, slots: ids } = CONFIG.ads.adsense;
  if (!client) return slots.forEach((s) => s.remove());
  injectScript(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`, { crossorigin: 'anonymous' });
  for (const slot of slots) {
    const slotId = ids[slot.dataset.slot];
    if (!slotId) {
      slot.remove();
      continue;
    }
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = client;
    ins.dataset.adSlot = slotId;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    slot.append(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }
}

export async function initAds() {
  const slots = [...document.querySelectorAll('.ad-slot')];
  if (!slots.length) return;
  const { active } = await status();
  if (!CONFIG.ads.enabled || active) {
    slots.forEach((s) => s.remove());
    document.documentElement.classList.add('no-ads');
    return;
  }
  for (const s of slots) s.classList.add('ad-on');
  if (CONFIG.ads.provider === 'adsense') setupAdsense(slots);
  else setupYandex(slots);
}
