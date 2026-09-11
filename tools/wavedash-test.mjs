// Strict fake Wavedash SDK against the real game, on the source and on the
// terser output the build ships. The stubs validate argument types the way the
// SDK does and count every call: a permissive stub would test nothing, and the
// game's guards swallow exceptions, so an empty console proves nothing either.
//   node tools/wavedash-test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { minify } from 'terser';
import TERSER from './terser-options.mjs';

const html = readFileSync('src/index.html', 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
const ids = new Set(JSON.parse(readFileSync('wavedash/achievements.json', 'utf8')).achievements.map(a => a.identifier));
const boards = JSON.parse(readFileSync('wavedash/leaderboards.json', 'utf8')).leaderboards;

// Game events exposed by reference, so the mangled build stays drivable.
const probe = `
self.test={
  start:function(){taught=1;startGame()},
  wolf:function(dx){var m={x:pl.x+dx,y:pl.y,face:-1,a:'move',t:0,hp:3,st:'walk',stT:0,kb:0,dead:0,deadT:0,wait:9,can:null};mobs.push(m);return m},
  can:function(dx){dropCan(pl.x+dx,pl.y);return cans[cans.length-1]},
  ko:function(){die(self.test.wolf(20),1)},
  bloom:function(){bloom(self.test.can(30))},
  smash:function(){mobs=[];combo=2;pl.face=1;self.test.wolf(15);resolveAttack()},
  beam:function(){pl.face=1;blast()},
  volley:function(){mobs=[];pl.face=1;var c=self.test.can(15);c.st='fly';c.thrower={};c.z=10;resolveAttack()},
  double:function(){mobs=[];pl.face=1;self.test.wolf(40);self.test.wolf(80);blast();for(var i=0;i<8;i++)update(.02)},
  clear:function(){mobs=[];cans=[];tut=9;phase='fight';over=0;update(.02)},
  street5:function(){arena=3;phase='clear';camX=(arena+1)*SCR-.2;pl.x=camX+300;update(.02)},
  score:function(n){scoreV=n;update(.02)},
  hurt:function(){pl.inv=0;hurtPlayer(1)},
  gameover:function(){lives=1;pl.inv=0;over=0;hurtPlayer(1)},
  frame:function(){draw(now()*1000)},
  state:function(){return{arena:arena,phase:phase,over:over,lives:lives,lives0:lives0,won:Object.keys(won),toasts:toasts.slice(),toast:toast}}
};`;

const tick = () => new Promise(r => setTimeout(r, 15));
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }

function make(code, { absent = false, scenario = '', statsGate, boardGate } = {}) {
  const calls = [], violations = [], unlocked = new Set(), errors = [];
  const validate = (ok, message) => { if (!ok) violations.push(message); };
  const sdk = {
    init() { calls.push(['init']); return true; },
    requestStats() { calls.push(['stats']); return statsGate ? statsGate.promise : Promise.resolve({ success: true, data: true }); },
    getAchievement(id) { validate(ids.has(id), 'unknown achievement ' + id); return unlocked.has(id); },
    setAchievement(id, store) {
      validate(ids.has(id) && store === true, 'setAchievement arguments ' + id + ' ' + typeof store);
      calls.push(['award', id]); unlocked.add(id); return true;
    },
    getOrCreateLeaderboard(name, sort, display) {
      const b = boards.find(b => b.name === name);
      validate(b && b.sort_order === sort && b.display_type === display, 'leaderboard options ' + name);
      calls.push(['board', name]);
      return (boardGate ? boardGate.promise : Promise.resolve()).then(() => ({ success: true, data: { id: 'lb-' + name, name, totalEntries: 0, created: true } }));
    },
    uploadLeaderboardScore(id, value, keep) {
      validate(boards.some(b => 'lb-' + b.name === id) && Number.isInteger(value) && value >= 0 && keep === true,
               'score arguments ' + id + ' ' + value + ' ' + typeof keep);
      calls.push(['score', id, value]); return Promise.resolve({ success: true });
    }
  };
  const [method, failure] = scenario.split(':');
  if (failure === 'missing') delete sdk[method];
  if (failure === 'throw') sdk[method] = () => { throw new Error(scenario); };
  if (failure === 'reject') sdk[method] = () => Promise.reject(new Error(scenario));
  if (failure === 'false') sdk[method] = () => Promise.resolve({ success: false });

  let clock = 0;
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdom: ' + e.message));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const page = '<!doctype html><canvas id=c></canvas><script>' + code + '\n</script>';
  const dom = new JSDOM(page, { runScripts: 'dangerously', virtualConsole: vc, beforeParse(w) {
    const ctx = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 1 }) : () => {}, set: () => true });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    // now() reads the AudioContext clock, so the fake context exposes the test clock.
    class P { constructor() { this.value = 0; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} setTargetAtTime() {} }
    class N { constructor() { this.gain = new P(); this.frequency = new P(); this.detune = new P(); this.Q = new P(); } connect() {} start() {} stop() {} }
    w.AudioContext = class { constructor() { this.sampleRate = 44100; this.state = 'running'; this.destination = {}; } get currentTime() { return clock; }
      createGain() { return new N(); } createOscillator() { return new N(); } createBufferSource() { return new N(); } createBiquadFilter() { return new N(); }
      createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; } resume() { return Promise.resolve(); } };
    w.requestAnimationFrame = () => 1;
    w.setInterval = () => 0; w.clearInterval = () => {};
    w.addEventListener('error', e => errors.push('window: ' + e.message));
    if (!absent) w.Wavedash = sdk;
  } });
  const w = dom.window;
  return { api: w.test, calls, violations, unlocked, errors, advance(s) { clock += s; } };
}

const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(String(e && e.message || e)));

const minified = (await minify(src + probe, TERSER)).code;
for (const [label, code] of [['source', src + probe], ['terser output', minified]]) {
  // 1. no SDK: every trophy still triggers the local banner, nothing is called
  const off = make(code, { absent: true });
  off.api.start(); off.api.ko(); off.api.bloom(); off.api.smash(); off.api.beam(); off.api.volley(); off.api.double();
  off.api.clear(); off.api.street5(); off.api.score(12000); off.api.gameover(); await tick();
  assert.deepEqual(off.calls, [], 'no platform call without the SDK');
  assert.deepEqual(new Set(off.api.state().won), ids, 'all ten conditions fire locally');
  assert.equal(off.api.state().toasts.length, 10, 'one banner queued per trophy');
  off.advance(3); off.api.frame();
  assert.equal(off.api.state().toast, 'FIRST KO', 'banner text derives from the identifier');
  off.advance(1); off.api.frame();
  assert.equal(off.api.state().toast, 'FIRST KO', 'a banner stays 2 s');
  off.advance(1.5); off.api.frame();
  assert.equal(off.api.state().toast, 'GARDENER', 'then the next queued banner shows');

  // 2. stats answers that must NOT unlock anything
  for (const response of [{ success: true, data: false }, { success: true }, { success: true, data: 1 }, { success: false, data: true }]) {
    const gate = deferred(), g = make(code, { statsGate: gate });
    g.api.start(); g.api.ko(); gate.resolve(response); await tick();
    assert.equal(g.unlocked.size, 0, 'stats must confirm data === true: ' + JSON.stringify(response));
  }

  // 3. trophies earned before the stats answer wait for it; repeats are deduplicated
  const gate = deferred(), g = make(code, { statsGate: gate });
  g.api.start();
  assert.deepEqual(g.calls.slice(0, 2), [['init'], ['stats']], 'init then requestStats at load');
  g.api.ko(); g.api.bloom(); await tick();
  assert.equal(g.unlocked.size, 0, 'nothing unlocked before the stats answer');
  gate.resolve({ success: true, data: true }); await tick();
  assert.deepEqual([...g.unlocked].sort(), ['FIRST_KO', 'GARDENER']);
  g.api.ko(); g.api.bloom(); await tick();
  assert.equal(g.calls.filter(c => c[0] === 'award').length, 2, 'no duplicate setAchievement');
  g.api.smash(); g.api.beam(); g.api.volley(); g.api.double(); g.api.clear();
  assert.equal(g.api.state().phase, 'clear', 'street cleared');
  g.api.street5(); g.api.score(10000); await tick();
  assert(!g.unlocked.has('TOP_CLEANER'), 'exactly 10,000 is not more than 10,000');
  g.api.score(10100); await tick();
  assert(g.unlocked.has('TOP_CLEANER'), 'more than 10,000 unlocks TOP_CLEANER');
  g.api.score(12000); await tick();
  assert.deepEqual([...g.unlocked].sort(), [...ids].sort(), 'the ten real conditions unlock');
  g.api.gameover(); await tick();
  assert.deepEqual(g.calls.filter(c => c[0] === 'score'), [['score', 'lb-high-score', 12000]], 'one high score at game over');
  assert.deepEqual(g.violations, []); assert.deepEqual(g.errors, []);

  // 4. a zero score is still a score; UNTOUCHABLE needs a clean street
  const z = make(code); z.api.start(); z.api.hurt(); z.api.clear(); await tick();
  assert(!z.unlocked.has('UNTOUCHABLE') && z.unlocked.has('CLEAN_SWEEP'), 'UNTOUCHABLE requires no life lost on the street');
  z.api.score(0); z.api.gameover(); await tick();
  assert.deepEqual(z.calls.filter(c => c[0] === 'score'), [['score', 'lb-high-score', 0]], 'score 0 is sent');

  // 5. broken SDKs: the game must stay silent and keep running
  let failures = 0;
  for (const method of ['init', 'requestStats', 'getAchievement', 'setAchievement', 'getOrCreateLeaderboard', 'uploadLeaderboardScore']) {
    const variants = ['missing', 'throw']; if (method !== 'getAchievement') variants.push('reject');
    if (['requestStats', 'getOrCreateLeaderboard'].includes(method)) variants.push('false');
    for (const failure of variants) {
      const r = make(code, { scenario: method + ':' + failure });
      r.api.start(); r.api.ko(); r.api.score(12000); r.api.gameover(); await tick();
      assert.deepEqual(r.errors, [], method + ':' + failure + ' must not log');
      assert.deepEqual(r.violations, []); failures++;
    }
  }
  assert.deepEqual(unhandled, [], 'no unhandled rejection');
  console.log('PASS ' + label + ': SDK absent, deferred stats, 4 bad stats answers, 10 trophies, dedupe, high score (incl. 0), ' + failures + ' broken-SDK cases');
}
