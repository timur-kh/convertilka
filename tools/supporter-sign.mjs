// Выпускает код «без рекламы» для того, кто сделал пожертвование.
//   node tools/supporter-sign.mjs [дней=30] [количество=1]
// Код действует указанное число дней с момента выпуска (+3 дня запаса, чтобы человек успел его ввести).
import { createPrivateKey, sign, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const days = Number(process.argv[2] || 30);
const count = Number(process.argv[3] || 1);
if (!(days > 0 && days <= 3660) || !(count >= 1 && count <= 1000)) {
  console.error('Использование: node tools/supporter-sign.mjs [дней 1–3660] [количество 1–1000]');
  process.exit(1);
}

const keyFile = join(dirname(fileURLToPath(import.meta.url)), 'keys', 'private.pem');
let key;
try {
  key = createPrivateKey(await readFile(keyFile));
} catch {
  console.error(`Нет закрытого ключа (${keyFile}). Сначала выполните: node tools/supporter-keygen.mjs`);
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const GRACE_DAYS = 3;
const exp = Math.floor(Date.now() / 1000) + (days + GRACE_DAYS) * 86400;

for (let i = 0; i < count; i++) {
  const payload = b64url(JSON.stringify({ exp, id: randomBytes(6).toString('hex') }));
  const head = `KV1.${payload}`;
  // ieee-p1363 — формат подписи (r||s), который понимает WebCrypto в браузере
  const sig = sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' });
  console.log(`${head}.${b64url(sig)}`);
}
console.error(`\nДействует до ${new Date(exp * 1000).toLocaleDateString('ru')} (${days} дн. + ${GRACE_DAYS} дн. запаса)`);
