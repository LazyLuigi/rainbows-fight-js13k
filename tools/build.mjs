// Build chain for js13kGames and Wavedash, from one snapshot of src/index.html:
//   extract -> terser -> roadroller (best of N draws) -> minimal HTML -> zip -> advzip
//
// Deliverables, replaced only when the ZIP fits the budget:
//   rainbow-fight.zip          contest archive, at the repository root
//   dist/js13k/index.html      the exact page stored in the ZIP (Roadroller)
//   dist/wavedash/index.html   the source as is: no minification, no Roadroller.
//                              The platform injects its own SDK at runtime.
// Flags:
//   --O2       roadroller level 2: slower, a few bytes smaller
//   --best=N   keep the smallest of N roadroller draws (its parameter search is random)
//   --no-rr    skip roadroller, write .build/fast/index.html and stop. This mode
//              never touches the deliverables, so a quick build cannot overwrite
//              the archive with an oversized one.
// No external zip binary: the archive is written with node's zlib, then advzip
// (AdvanceCOMP, zopfli) recompresses the same content when it is installed.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, renameSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { minify } from 'terser';
import { Packer } from 'roadroller';

const LIMIT = 13312;                       // 13 * 1024, the competition budget
const SRC = 'src/index.html';
const ZIP = 'rainbow-fight.zip';
const args = process.argv.slice(2);
const level = args.includes('--O2') ? 2 : 1;
const BEST = +(args.find(a => a.startsWith('--best=')) || '').slice(7) || 1;
const NORR = args.includes('--no-rr');

// ---- 1. pull the script and the style out of the readable source ----------
const html = readFileSync(SRC, 'utf8');
const js = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1];
if (!js) { console.error('No <script> block found in ' + SRC); process.exit(1); }
const css = ((html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '').trim();

// ---- 2. terser -----------------------------------------------------------
// No booleans_as_integers: the Wavedash SDK validates argument types and would
// silently reject a `1` where it expects `true`.
const min = await minify(js, {
  compress: { passes: 3, unsafe: true },
  mangle: { toplevel: true },
  format: { comments: false }
});
if (min.error) throw min.error;
console.log('terser     :', Buffer.byteLength(min.code), 'bytes');

// ---- 3. minimal HTML shell -----------------------------------------------
// The viewport tag is kept: without it phones lay the page out at 980px wide.
const shell = code =>
  '<!doctype html><meta charset=utf-8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">' +
  '<title>Rainbow Fight</title>' +
  (css ? '<style>' + css + '</style>' : '') +
  '<canvas id=c></canvas>' +
  '<script>' + code + '</script>';

if (NORR) {
  mkdirSync('.build/fast', { recursive: true });
  writeFileSync('.build/fast/index.html', shell(min.code));
  console.log('.build/fast/index.html written (terser only, outside the budget). Deliverables untouched.');
  process.exit(0);
}

// ---- 4. roadroller, best of N, then zip each candidate ---------------------
mkdirSync('.build', { recursive: true });
const stage = mkdtempSync(resolve('.build/stage-'));
let advzipMissing = false;
try {
  let best = null;
  for (let i = 0; i < BEST; i++) {
    const packer = new Packer([{ data: min.code, type: 'js', action: 'eval' }], {});
    await packer.optimize(level);
    const { firstLine, secondLine } = packer.makeDecoder();
    const page = shell(firstLine + secondLine);
    const zip = packZip(page);
    console.log('draw ' + (i + 1) + '/' + BEST + '  : roadroller ' + Buffer.byteLength(firstLine + secondLine) +
                ' bytes (-O' + level + '), zip ' + zip.length + ' bytes');
    if (!best || zip.length < best.zip.length) best = { page, zip };
  }
  if (advzipMissing) console.log('advzip not found: kept the zlib archive. brew install advancecomp to save a few percent.');

  const margin = LIMIT - best.zip.length;
  console.log('-'.repeat(46));
  console.log('ZIP        :', best.zip.length, 'bytes /', LIMIT, 'max');
  if (margin < 0) {
    console.log('OVER BUDGET by ' + -margin + ' bytes. Previous deliverables preserved.');
    process.exitCode = 1;
  } else {
    // ---- 5. swap the deliverables in, atomically enough --------------------
    // dist/ belongs to the build: only the two delivery targets live there.
    const release = join(stage, 'release'), backup = join(stage, 'previous-dist');
    mkdirSync(join(release, 'js13k'), { recursive: true });
    mkdirSync(join(release, 'wavedash'), { recursive: true });
    writeFileSync(join(release, 'js13k/index.html'), best.page);
    writeFileSync(join(release, 'wavedash/index.html'), html);
    const hadDist = existsSync('dist');
    if (hadDist) renameSync('dist', backup);
    try {
      renameSync(release, 'dist');
      writeFileSync(ZIP, best.zip);
    } catch (e) {
      rmSync('dist', { recursive: true, force: true });
      if (hadDist) renameSync(backup, 'dist');
      throw e;
    }
    console.log('IN BUDGET. Margin: ' + margin + ' bytes.');
    console.log('  ' + ZIP + '           (submit this)');
    console.log('  dist/js13k/index.html      (the page inside the ZIP)');
    console.log('  dist/wavedash/index.html   (source copy, upload_dir of wavedash.toml)');
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}

// --------------------------------------------------------------------------
// zlib deflate -9, then advzip when available. The recompressed container is
// only kept if it is smaller AND still inflates to the exact same page.
function packZip(page) {
  const data = Buffer.from(page);
  let zip = zipOne('index.html', data);
  const p = join(stage, 'candidate.zip');
  writeFileSync(p, zip);
  try {
    execFileSync('advzip', ['-z', '-4', '-i', '100', '-q', p], { stdio: 'pipe' });
    const re = readFileSync(p);
    if (re.length < zip.length && unzipOne(re).equals(data)) zip = re;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    advzipMissing = true;
  }
  return zip;
}

// Reads the single entry of a zip through its central directory and inflates it.
// Throws if the archive is not "exactly one index.html at the root".
function unzipOne(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  if (buf.readUInt16LE(eocd + 10) !== 1) throw new Error('zip: expected exactly one entry');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('zip: bad central directory');
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20);
  const nlen = buf.readUInt16LE(cd + 28), lho = buf.readUInt32LE(cd + 42);
  if (buf.toString('utf8', cd + 46, cd + 46 + nlen) !== 'index.html') throw new Error('zip: entry is not index.html');
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const body = buf.subarray(start, start + csize);
  if (method === 8) return inflateRawSync(body);
  if (method === 0) return Buffer.from(body);
  throw new Error('zip: unsupported method ' + method);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipOne(name, data) {
  const nameBuf = Buffer.from(name);
  const body = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);      // local file header
  local.writeUInt16LE(20, 4);              // version needed
  local.writeUInt16LE(0, 6);               // flags
  local.writeUInt16LE(8, 8);               // deflate
  local.writeUInt16LE(0, 10);              // time
  local.writeUInt16LE(0x21, 12);           // date (1996-01-01, keeps it deterministic)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);              // extra field length
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);    // central directory header
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);            // offset of the local header
  const end = Buffer.alloc(22);
  const centralSize = central.length + nameBuf.length;
  end.writeUInt32LE(0x06054b50, 0);        // end of central directory
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(local.length + nameBuf.length + body.length, 16);
  return Buffer.concat([local, nameBuf, body, central, nameBuf, end]);
}
