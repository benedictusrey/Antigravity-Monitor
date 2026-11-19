import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/**
 * Patch ZIP headers so POSIX unzip/Finder restores directories and +x bits on
 * `.sh` and `.command` entrypoints even when the archive was built on Windows.
 */
export function setZipUnixPermissions(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`Missing ZIP end-of-central-directory in ${zipPath}`);

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(pos) !== CD_SIG) throw new Error(`Invalid ZIP central directory header at ${pos}`);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const rawName = buf.subarray(pos + 46, pos + 46 + nameLen);
    const name = rawName.toString('utf8').replaceAll('\\', '/');
    const encoded = Buffer.from(name, 'utf8');
    if (encoded.length === nameLen) {
      encoded.copy(buf, pos + 46);
      if (localOffset + 30 + nameLen <= buf.length && buf.readUInt32LE(localOffset) === LFH_SIG) {
        const lhNameLen = buf.readUInt16LE(localOffset + 26);
        if (lhNameLen === nameLen) encoded.copy(buf, localOffset + 30);
      }
    }
    const mode = name.endsWith('/') ? 0o040755 : (name.endsWith('.sh') || name.endsWith('.command') ? 0o100755 : 0o100644);
    buf.writeUInt16LE((3 << 8) | (buf.readUInt16LE(pos + 4) & 0xff), pos + 4);
    buf.writeUInt32LE(((mode << 16) | (buf.readUInt32LE(pos + 38) & 0xffff)) >>> 0, pos + 38);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  fs.writeFileSync(zipPath, buf);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) { console.error('Usage: node scripts/set-zip-permissions.mjs <zip>...'); process.exitCode = 1; }
  else { for (const target of targets) setZipUnixPermissions(path.resolve(target)); }
}
