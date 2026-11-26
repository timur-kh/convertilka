// Страница 404: «конвертация» числа 404 по клику и мини-игра «Сортировщик файлов».
// Игра видна всегда; пасхалки — «404 во всех форматах» и чит-код Konami (↑↑↓↓←→←→BA) на +3 жизни.

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 404 во всех форматах ----------
const FORMATS = [
  { ext: 'dec', v: '404' },
  { ext: 'hex', v: '0x194' },
  { ext: 'bin', v: '110010100', small: true },
  { ext: 'oct', v: '0o624' },
  { ext: 'roman', v: 'CDIV' },
  { ext: 'morse', v: '····– ––––– ····–', small: true },
  { ext: 'txt', v: 'четыреста четыре', small: true },
  { ext: 'emoji', v: '4️⃣0️⃣4️⃣' },
  { ext: 'zip', v: '4·0·4', note: 'сжато на 0%' },
  { ext: 'upside', v: 'ㄣ0ㄣ' },
];
const JOKES = [
  'Возможно, её сконвертировали во что-то другое.',
  'Мы проверили все 50 форматов — её нет ни в одном.',
  'Даже FFmpeg не смог её найти, а он находит дорожки в любом видео.',
  'Страница ушла в .tmp и не вернулась.',
  'Похоже, ссылка была в формате .broken — такой мы не поддерживаем.',
  'Её сжали до 0 байт. Перестарались.',
  'Страница сконвертировалась в пустоту — а формат .void мы пока не поддерживаем.',
];

const code = $('nf-code'), digits = $('nf-digits'), label = $('nf-format'), bar = $('nf-progress');
let fi = 0, busy = false;
const seen = new Set([0]);
$('nf-joke').textContent = JOKES[Math.floor(Math.random() * JOKES.length)];

function setLabel(from, to, hint) {
  label.replaceChildren();
  const badge = (t) => Object.assign(document.createElement('span'), { className: 'nf-badge', textContent: t });
  label.append(badge(`404.${from}`));
  if (to) label.append(' → ', badge(`404.${to}`));
  if (hint) label.append(Object.assign(document.createElement('span'), { className: 'nf-hint', textContent: ` ${hint}` }));
}

code.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  const next = (fi + 1) % FORMATS.length;
  setLabel(FORMATS[fi].ext, FORMATS[next].ext, 'конвертируем…');
  code.classList.add('is-converting');
  bar.hidden = false;
  bar.firstElementChild.style.animationDuration = reduceMotion ? '1ms' : '.6s';
  await new Promise((r) => setTimeout(r, reduceMotion ? 50 : 620));
  fi = next;
  seen.add(fi);
  const f = FORMATS[fi];
  digits.textContent = f.v;
  digits.classList.toggle('is-small', !!f.small);
  code.classList.remove('is-converting');
  bar.hidden = true;
  const left = FORMATS.length - seen.size;
  setLabel(f.ext, null, f.note ? `— ${f.note}` : `— готово за 0.6 с${left ? ` · неоткрытых форматов: ${left}` : allSeen ? ' · 🏆 все форматы открыты' : ''}`);
  busy = false;
  if (seen.size === FORMATS.length && !allSeen) {
    allSeen = true;
    setLabel(f.ext, null, '— 🏆 Все форматы открыты! Вы настоящий конвертер.');
  }
});
let allSeen = false;

// ---------- Мини-игра (всегда на странице) и пасхалка: чит-код Konami ----------
console.log('%c🕹️ Psst… В игре есть чит-код.', 'font: 600 14px system-ui; color: #7c3aed');
console.log('Вспомните код из 1986 года: ↑ ↑ ↓ ↓ ← → ← → B A — и получите +3 жизни (раз за игру).');

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let kpos = 0;
let cheat = () => {};
document.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const want = KONAMI[kpos];
  // b/a в русской раскладке — «и»/«ф»
  kpos = k === want || (want === 'b' && k === 'и') || (want === 'a' && k === 'ф') ? kpos + 1 : k === KONAMI[0] ? 1 : 0;
  if (kpos === KONAMI.length) {
    kpos = 0;
    cheat();
  }
});

startGame();

function startGame() {
  const canvas = $('nf-canvas');
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim() || '#888';
  const GOOD = [
    ['png', '--g-image'], ['jpg', '--g-image'], ['webp', '--g-image'], ['heic', '--g-image'],
    ['pdf', '--g-document'], ['docx', '--g-document'], ['epub', '--g-document'], ['djvu', '--g-document'],
    ['xlsx', '--g-sheet'], ['csv', '--g-sheet'],
    ['stl', '--g-model'], ['step', '--g-model'], ['glb', '--g-model'],
    ['mp4', '--g-video'], ['mov', '--g-video'], ['mkv', '--g-video'],
    ['mp3', '--g-audio'], ['wav', '--g-audio'], ['flac', '--g-audio'],
  ];
  // Во что «конвертируется» пойманный файл — для всплывающей подписи
  const INTO = { png: 'webp', jpg: 'webp', webp: 'png', heic: 'jpg', pdf: 'docx', docx: 'pdf', epub: 'fb2', djvu: 'pdf', xlsx: 'csv', csv: 'xlsx', stl: 'obj', step: 'stl', glb: 'stl', mp4: 'mp3', mov: 'mp4', mkv: 'mp4', mp3: 'm4a', wav: 'mp3', flac: 'mp3' };
  let best = 0;
  try { best = Number(localStorage.getItem('kv-404-best')) || 0; } catch { /* приватный режим */ }
  $('nf-best').textContent = best;

  let W = 900, H = 420, dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || 900;
    H = Math.round(Math.min(420, Math.max(300, W * 0.5)));
    canvas.style.height = `${H}px`;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const player = { x: W / 2, w: 96, h: 26, target: W / 2 };
  let files = [], pops = [], score = 0, lives = 3, speed = 1, spawnIn = 0, state = 'ready', shake = 0, last = 0;

  const setLives = () => { $('nf-lives').textContent = '❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, 3 - lives)); };
  let cheatUsed = false;
  // Konami: +3 жизни, один раз за игру — и только когда игра идёт
  cheat = () => {
    if (state !== 'play' || cheatUsed) {
      pops.push({ x: W / 2, y: H / 2, t: 1.4, text: state === 'play' ? 'Чит уже использован в этой игре 😉' : 'Начните игру — и повторите код 😉', c: '--muted' });
      return;
    }
    cheatUsed = true;
    lives += 3;
    setLives();
    pops.push({ x: W / 2, y: H / 2, t: 1.8, text: '🎮 Чит-код принят: +3 ❤️', c: '--accent' });
  };
  const reset = () => {
    files = []; pops = []; score = 0; lives = 3; speed = 1; spawnIn = 0; shake = 0; cheatUsed = false;
    $('nf-score').textContent = '0';
    setLives();
  };

  // Управление: мышь/палец — к точке, стрелки — шагом
  const toX = (e) => {
    const r = canvas.getBoundingClientRect();
    player.target = Math.max(player.w / 2, Math.min(W - player.w / 2, e.clientX - r.left));
  };
  canvas.addEventListener('pointermove', toX);
  canvas.addEventListener('pointerdown', (e) => {
    toX(e);
    if (state !== 'play') begin();
  });
  canvas.style.touchAction = 'none';
  const keys = new Set();
  addEventListener('keydown', (e) => {
    if ($('nf-game').hidden) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      keys.add(e.key);
      if (state === 'play') e.preventDefault();
    }
    if ((e.key === ' ' || e.key === 'Enter') && state !== 'play' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      begin();
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') state = 'pause'; });

  function begin() {
    if (state === 'pause') { state = 'play'; return; }
    reset();
    state = 'play';
  }

  function spawn() {
    const bad = Math.random() < Math.min(0.12 + score * 0.004, 0.3);
    const [ext, g] = bad ? ['exe', '--err'] : GOOD[Math.floor(Math.random() * GOOD.length)];
    files.push({ x: 30 + Math.random() * (W - 60), y: -40, ext, bad, col: color(g), vy: (70 + Math.random() * 50) * speed, rot: 0, r0: (Math.random() - 0.5) * 0.3 });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFile(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    const w = 44, h = 54;
    // лист с загнутым уголком
    ctx.fillStyle = color('--surface');
    ctx.strokeStyle = f.col;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2 - 12, -h / 2);
    ctx.lineTo(w / 2, -h / 2 + 12);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = f.col;
    roundRect(-w / 2 - 4, 4, w + 8, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.ext.toUpperCase(), 0, 13.5);
    if (f.bad) {
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('☠️', 0, -10);
    }
    ctx.restore();
  }

  function drawPlayer() {
    const y = H - 30;
    const grad = ctx.createLinearGradient(player.x - player.w / 2, 0, player.x + player.w / 2, 0);
    grad.addColorStop(0, color('--accent'));
    grad.addColorStop(1, color('--accent-2'));
    ctx.fillStyle = grad;
    // воронка конвертера
    ctx.beginPath();
    ctx.moveTo(player.x - player.w / 2, y - 8);
    ctx.lineTo(player.x + player.w / 2, y - 8);
    ctx.lineTo(player.x + player.w / 2 - 14, y + player.h - 8);
    ctx.lineTo(player.x - player.w / 2 + 14, y + player.h - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⇄', player.x, y + 4);
  }

  function centerText(lines) {
    ctx.fillStyle = color('--text');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach(([t, size, weight = 700, c], i) => {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.fillStyle = c ? color(c) : color('--text');
      ctx.fillText(t, W / 2, H / 2 - (lines.length - 1) * 16 + i * 32);
    });
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake = Math.max(0, shake - dt * 40);
    }
    // фон: сетка «рабочего стола»
    ctx.strokeStyle = color('--border');
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

    if (state === 'play') {
      if (keys.has('ArrowLeft')) player.target -= 520 * dt;
      if (keys.has('ArrowRight')) player.target += 520 * dt;
      player.target = Math.max(player.w / 2, Math.min(W - player.w / 2, player.target));
      speed = 1 + score / 25;
      spawnIn -= dt;
      if (spawnIn <= 0) {
        spawn();
        spawnIn = Math.max(0.35, 1.1 - score * 0.02) * (0.7 + Math.random() * 0.6);
      }
      const py = H - 38;
      for (const f of files) {
        f.y += f.vy * dt;
        f.rot = f.r0 + Math.sin(f.y / 45) * 0.18; // лёгкое покачивание, без кувырков
        if (!f.done && f.y > py - 20 && f.y < py + 14 && Math.abs(f.x - player.x) < player.w / 2 + 10) {
          f.done = true;
          if (f.bad) {
            lives--;
            shake = 14;
            pops.push({ x: f.x, y: py - 30, t: 1, text: 'Вирус! −❤️', c: '--err' });
          } else {
            score++;
            pops.push({ x: f.x, y: py - 30, t: 1, text: `+1 → .${INTO[f.ext] || 'pdf'}`, c: '--ok' });
          }
        } else if (!f.done && f.y > H + 30) {
          f.done = true;
          if (!f.bad) {
            lives--;
            shake = 8;
            pops.push({ x: f.x, y: H - 60, t: 1, text: `.${f.ext} потерян`, c: '--warn' });
          }
        }
      }
      files = files.filter((f) => !f.done);
      $('nf-score').textContent = score;
      setLives();
      if (lives <= 0) {
        state = 'over';
        if (score > best) {
          best = score;
          try { localStorage.setItem('kv-404-best', String(best)); } catch { /* приватный режим */ }
          $('nf-best').textContent = best;
        }
      }
    }
    player.x += (player.target - player.x) * Math.min(1, dt * 14);
    for (const f of files) drawFile(f);
    drawPlayer();
    for (const p of pops) {
      p.t -= dt;
      p.y -= dt * 40;
      ctx.globalAlpha = Math.max(0, p.t);
      ctx.fillStyle = color(p.c);
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, Math.max(70, Math.min(W - 70, p.x)), p.y); // не вылезать за край
      ctx.globalAlpha = 1;
    }
    pops = pops.filter((p) => p.t > 0);
    ctx.restore();

    if (state === 'ready') centerText([['Сортировщик файлов', 26], ['Нажмите на поле или пробел, чтобы начать', 15, 500, '--muted']]);
    else if (state === 'pause') centerText([['Пауза', 26], ['Нажмите, чтобы продолжить', 15, 500, '--muted']]);
    else if (state === 'over') {
      const title = score >= 50 ? 'Вы — ядро FFmpeg во плоти!' : score >= 25 ? 'Отличная конвертация!' : score >= 10 ? 'Неплохо для первого раза' : 'Файлы разбежались';
      centerText([[title, 24], [`Сконвертировано файлов: ${score} · рекорд: ${best}`, 16, 500, '--muted'], ['Нажмите, чтобы сыграть ещё', 15, 500, '--accent']]);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
