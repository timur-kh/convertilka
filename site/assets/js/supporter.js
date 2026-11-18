// Коды «без рекламы» для тех, кто поддержал проект.
// Формат кода: KV1.<payload base64url>.<подпись ECDSA P-256/SHA-256 base64url>
// payload = {"exp": <unix-время окончания, сек>, "id": "<случайный id>"}
// Подписываются офлайн владельцем сайта (tools/supporter-sign.mjs), проверяются здесь открытым ключом.
import { CONFIG } from './config.js';

const STORAGE_KEY = 'kv-supporter-code';

const b64urlToBytes = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

let keyPromise;
function publicKey() {
  if (!CONFIG.supporterPublicKey) return null;
  keyPromise ||= crypto.subtle.importKey('jwk', CONFIG.supporterPublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return keyPromise;
}

/** Проверяет код. Возвращает { ok, expires?: Date, reason? } */
export async function verifyCode(code) {
  code = String(code || '').trim().replace(/\s+/g, '');
  const parts = code.split('.');
  if (parts.length !== 3 || parts[0] !== 'KV1') return { ok: false, reason: 'Неверный формат кода' };
  const key = await publicKey();
  if (!key) return { ok: false, reason: 'Проверка кодов ещё не настроена владельцем сайта' };
  try {
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlToBytes(parts[2]), signed);
    if (!valid) return { ok: false, reason: 'Код недействителен' };
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    const expires = new Date(payload.exp * 1000);
    if (!(expires > new Date())) return { ok: false, reason: `Срок действия кода истёк ${expires.toLocaleDateString('ru')}`, expires };
    return { ok: true, expires };
  } catch {
    return { ok: false, reason: 'Код повреждён' };
  }
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null; // приватный режим или запрет cookies
  }
}

/** Активирует код и сохраняет его в браузере. */
export async function activate(code) {
  const res = await verifyCode(code);
  if (res.ok) storage()?.setItem(STORAGE_KEY, String(code).trim().replace(/\s+/g, ''));
  return res;
}

export function deactivate() {
  storage()?.removeItem(STORAGE_KEY);
}

/** Текущий статус: { active, expires } */
export async function status() {
  const code = storage()?.getItem(STORAGE_KEY);
  if (!code) return { active: false };
  const res = await verifyCode(code);
  if (!res.ok) {
    if (res.expires) deactivate();
    return { active: false, expired: !!res.expires, expires: res.expires };
  }
  return { active: true, expires: res.expires };
}
