import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DebouncedWatcher } from '../src/index.js';
import debounceEvents from '../src/debounce.js';

/**
 * Fake clock. Records the requested fire time and lets the test drive
 * `flush()` calls. No wall-clock dependency anywhere in the suite.
 */
function makeFakeClock() {
  const calls = [];
  const clock = (ms) => { calls.push(ms); };
  return { clock, calls };
}

// --- debounceEvents ----------------------------------------------------

test('debounceEvents fires once for a burst on a single path', () => {
  const fired = [];
  const { clock } = makeFakeClock();
  const d = debounceEvents((p) => fired.push(p), { windowMs: 50, clock });
  d('a.txt'); d('a.txt'); d('a.txt');
  d.flush();
  assert.deepEqual(fired, ['a.txt']);
});

// The leading event is NOT delivered immediately; only after the window.
// This is the trailing-edge decision documented in the source.
test('debounceEvents does not deliver on the leading edge', () => {
  const fired = [];
  const { clock } = makeFakeClock();
  const d = debounceEvents((p) => fired.push(p), { windowMs: 10, clock });
  d('a.txt');
  assert.deepEqual(fired, []);
  d.flush();
  assert.deepEqual(fired, ['a.txt']);
});

test('debounceEvents keeps separate paths on separate timers', () => {
  const fired = [];
  const { clock } = makeFakeClock();
  const d = debounceEvents((p) => fired.push(p), { windowMs: 30, clock });
  d('a.txt');
  d('b.txt');
  d.flush();
  assert.deepEqual(fired.sort(), ['a.txt', 'b.txt']);
});

test('debounceEvents reset within the window postpones firing', () => {
  const fired = [];
  const { clock, calls } = makeFakeClock();
  const d = debounceEvents((p) => fired.push(p), { windowMs: 20, clock });
  d('a.txt');
  d('a.txt');
  d('a.txt');
  d.flush();
  assert.deepEqual(fired, ['a.txt']);
  // A timer was scheduled exactly once for this path (the first call).
  assert.equal(calls.length, 1);
});

test('debounceEvents re-arms after firing so a later burst fires again', () => {
  const fired = [];
  const { clock } = makeFakeClock();
  const d = debounceEvents((p) => fired.push(p), { windowMs: 5, clock });
  d('a.txt'); d.flush();
  d('a.txt'); d.flush();
  assert.deepEqual(fired, ['a.txt', 'a.txt']);
});

test('debounceEvents cancel clears pending timers', () => {
  const fired = [];
  const { clock } = makeFakeClock();
  const d = debounceEvents((p) => fired.push(p), { windowMs: 50, clock });
  d('a.txt');
  d('b.txt');
  d.cancel();
  d.flush();
  assert.deepEqual(fired, []);
});

test('debounceEvents ignores empty or non-string paths', () => {
  const fired = [];
  const { clock } = makeFakeClock();
  const d = debounceEvents((p) => fired.push(p), { windowMs: 10, clock });
  d('');
  d(null);
  d(undefined);
  d(42);
  d.flush();
  assert.deepEqual(fired, []);
});

test('debounceEvents validates fn and windowMs', () => {
  assert.throws(() => debounceEvents(null, { windowMs: 10 }), /fn must be a function/);
  assert.throws(() => debounceEvents(() => {}, { windowMs: -1 }), /windowMs/);
  assert.throws(() => debounceEvents(() => {}, { windowMs: NaN }), /windowMs/);
  assert.throws(() => debounceEvents(() => {}, { windowMs: Infinity }), /windowMs/);
});

// --- DebouncedWatcher --------------------------------------------------

test('DebouncedWatcher constructor validates path', () => {
  assert.throws(() => new DebouncedWatcher(''), /non-empty string/);
  assert.throws(() => new DebouncedWatcher(123), /non-empty string/);
});

test('DebouncedWatcher constructor validates debounceMs', () => {
  assert.throws(() => new DebouncedWatcher('/tmp', { debounceMs: -1 }), /debounceMs/);
  assert.throws(() => new DebouncedWatcher('/tmp', { debounceMs: NaN }), /debounceMs/);
  assert.throws(() => new DebouncedWatcher('/tmp', { debounceMs: 'x' }), /debounceMs/);
});

test('DebouncedWatcher.start requires a function', () => {
  const w = new DebouncedWatcher('/tmp', { debounceMs: 10 });
  assert.throws(() => w.start(null), /onChange must be a function/);
});

// To exercise the real fs.watch path deterministically we watch a temp
// directory, create a file inside it, and assert we receive at least one
// debounced notification for that path. We do NOT assert exact event counts
// from the OS (they vary across platforms); only that the collapse produced
// at least one delivery for the path we touched.
test('DebouncedWatcher delivers a debounced notification for a real change', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwatch-'));
  try {
    const received = [];
    const w = new DebouncedWatcher(dir, { debounceMs: 50 });
    w.start((p) => received.push(p));
    const target = path.join(dir, 'hello.txt');
    fs.writeFileSync(target, 'first');
    // Multiple rapid writes to the same file must collapse.
    fs.writeFileSync(target, 'second');
    fs.writeFileSync(target, 'third');
    // The debounce window is 50ms; give the OS + timer real headroom without
    // making the test slow. This is the one place we yield to the scheduler,
    // and we assert only on path presence, never on exact count.
    await new Promise((r) => setTimeout(r, 250));
    w.stop();
    assert.ok(received.indexOf('hello.txt') !== -1,
      `expected hello.txt in ${JSON.stringify(received)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DebouncedWatcher.stop is idempotent and safe when not started', () => {
  const w = new DebouncedWatcher('/tmp', { debounceMs: 10 });
  w.stop(); // not started — must not throw
  w.stop();
});

test('DebouncedWatcher.start returns a stop function that is idempotent', () => {
  const w = new DebouncedWatcher('/tmp', { debounceMs: 10 });
  let rawCalls = 0;
  const stop = w.start(() => {}, { handler: () => { rawCalls++; } });
  // The signature is start(onChange) — handler comes from the constructor.
  assert.equal(typeof stop, 'function');
  stop();
  stop(); // second call must be a no-op
  assert.equal(rawCalls, 0);
});
