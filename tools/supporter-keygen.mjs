// Создаёт пару ключей для кодов «без рекламы». Запускается ОДИН раз.
//   node tools/supporter-keygen.mjs
// Закрытый ключ → tools/keys/private.pem (храните в секрете и сделайте резервную копию!)
// Открытый ключ → выводится на экран, вставьте его в site/assets/js/config.js → supporterPublicKey
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'keys');
const file = join(dir, 'private.pem');

try {
  await access(file);
  console.error(`Ключ уже существует: ${file}\nЕсли создать новый, все выданные коды перестанут работать. Удалите файл вручную, если это действительно нужно.`);
  process.exit(1);
} catch { /* ключа нет — создаём */ }

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
await mkdir(dir, { recursive: true });
await writeFile(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
console.log(`Закрытый ключ сохранён: ${file}`);
console.log('\nВставьте в site/assets/js/config.js:\n');
console.log(`  supporterPublicKey: ${JSON.stringify({ kty, crv, x, y })},\n`);
