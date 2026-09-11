// Autopilot for deterministic captures with record-gif.py (js13k-finalize skill):
//   python3 "$S/record-gif.py" --driver tools/gif-driver.js --keep-frames \
//           --state-js "({arena:arena,phase:phase,over:over,lives:lives,score:scoreV,cleaned:cleaned})"
// The harness injects this file before the game and calls window.__drive(t)
// once per simulated frame. It reads the game's globals from src/index.html
// (the build mangles them, so this only works against the source) and writes
// where the game reads its inputs: the `keys` map plus hitDown()/hitUp().
// Same decisions as tools/autoplay.mjs, spread over frames instead of a loop.
(function () {
  // Without an AudioContext, now() follows performance.now(), which the harness
  // drives at a fixed step. A real (suspended) context would freeze the clock.
  window.AudioContext = window.webkitAudioContext = undefined;
  var frame = 0, charging = false, chargeStart = 0, queue = [], held = {};
  var START_FRAME = +(window.__startFrame || 40);      // title screen shown before the run
  function set(k, on) { on = !!on; if (!!held[k] === on) return; held[k] = on; keys[k] = on ? 1 : 0; }
  function release() { set('left', 0); set('right', 0); set('up', 0); set('down', 0); }
  function tap() { hitDown(); hitUp(); }
  function noop() {}
  function snapshot() {
    return {
      mobs: mobs.map(function (m) { return { dx: m.x - pl.x, dy: m.y - pl.y, dead: m.dead }; }),
      cans: cans.map(function (c) { return { st: c.st, dx: c.x - pl.x, dy: c.y - pl.y, z: c.z, thrower: !!c.thrower }; }),
      scrR: (arena + 1) * SCR - pl.x, charging: pl.charging, charge: pl.charge, atk: pl.atk
    };
  }
  window.__drive = function () {
    frame++;
    if (!started) { if (frame === START_FRAME) { taught = 1; tap(); } return; }   // skip the tutorial, start
    if (over) return;
    if (queue.length) { queue.shift()(); recalcMove(); return; }
    var d = snapshot();
    var m = d.mobs.filter(function (x) { return !x.dead; })
                  .sort(function (a, b) { return Math.abs(a.dx) - Math.abs(b.dx); })[0];
    var trash = d.cans.filter(function (c) { return c.st !== 'flower' && c.dx < d.scrR; });
    var inc = d.cans.filter(function (c) { return c.st === 'fly' && c.thrower && Math.abs(c.dx) < 36 && Math.abs(c.dy) < 16; })[0];
    if (d.charging || charging) {                        // hold until full, then release
      if (d.charge >= 1 || frame - chargeStart > 150) { hitUp(); charging = false; }
      recalcMove(); return;
    }
    if (inc) {                                           // volley a thrown can straight back
      release(); set(inc.dx > 0 ? 'right' : 'left', 1);
      queue.push(function () { release(); tap(); });
    } else if (m) {                                      // fight: face it, close in, punch
      var want = m.dx > 0 ? 26 : -26;
      set('right', m.dx > want + 4); set('left', m.dx < want - 4); set('down', m.dy > 4); set('up', m.dy < -4);
      if (Math.abs(m.dx) < 30 && Math.abs(m.dx) > 8 && Math.abs(m.dy) < 10 && frame % 4 === 0) {
        release(); set(m.dx > 0 ? 'right' : 'left', 1);
        queue.push(function () { release(); tap(); });
      }
    } else if (trash.length) {                           // clean: line up with a can and charge
      var c = trash.sort(function (a, b) { return Math.abs(a.dx) - Math.abs(b.dx); })[0];
      set('down', c.dy > 4); set('up', c.dy < -4);
      var wantC = c.dx > 0 ? 40 : -40;
      set('right', c.dx > wantC + 6 && c.dx > 0); set('left', c.dx < wantC - 6 && c.dx < 0);
      if (Math.abs(c.dy) < 6 && Math.abs(c.dx) > 20) {
        if (d.atk > 0) { release(); recalcMove(); return; }
        release(); set(c.dx > 0 ? 'right' : 'left', 1);   // face the can, then hold the hit button
        queue.push(noop, function () { release(); }, function () { hitDown(); charging = true; chargeStart = frame; });
      } else if (Math.abs(c.dx) <= 20) { set(c.dx > 0 ? 'left' : 'right', 1); }
    } else { release(); set('right', 1); }               // street clean: walk to the next one
    recalcMove();
  };
})();
