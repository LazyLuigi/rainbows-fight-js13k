// Syntax check on the readable source, without launching a browser.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = readFileSync('src/index.html', 'utf8');
const js = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1];
if (!js) { console.error('No <script> block found'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'rf-'));
const file = join(dir, 'game.js');
writeFileSync(file, js);
execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log('syntax OK  (' + js.split('\n').length + ' lines, ' + Buffer.byteLength(js) + ' bytes)');
