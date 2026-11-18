// Генерирует tests/fixture-code.json для самотеста (временный ключ, не связан с боевым).
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const b64 = (b) => Buffer.from(b).toString('base64url');
const mk = (exp) => {
  const head = `KV1.${b64(JSON.stringify({ exp, id: randomBytes(6).toString('hex') }))}`;
  return `${head}.${b64(sign('sha256', Buffer.from(head), { key: privateKey, dsaEncoding: 'ieee-p1363' }))}`;
};
const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
const now = Math.floor(Date.now() / 1000);
await writeFile(new URL('./fixture-code.json', import.meta.url), JSON.stringify({ publicKey: { kty, crv, x, y }, code: mk(now + 30 * 86400), expiredCode: mk(now - 86400) }, null, 2));
console.log('fixture ok');
