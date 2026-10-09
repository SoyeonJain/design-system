import debounceEvents from './debounce.js';

/**
 * Collapses rapid duplicate file change events from `fs.watch` into single
 * notifications per path within a configurable window.
 *
 * Why wrap `fs.watch` instead of polling? `fs.watch` is event-driven and cheap,
 * but on most platforms a single save triggers two to six events ('rename'
 * immediately followed by 'change', often duplicated). Collapsing them avoids
 * triggering expensive downstream work (recompilation, reload, index rebuild)
 * more than once per logical edit.
 *
 * Interpretation chosen: the debouncer groups ONLY by path. The `eventType`
 * argument from `fs.watch` ('change' / 'rename') is NOT forwarded or merged;
 * consumers that need to distinguish rename from change should watch at a
 * higher level. This is stated plainly in the README and is the one behaviour
 * the tests assert.
 *
 * The clock is injectable so tests are deterministic. No test ever touches
 * wall-clock time.
 */
export class DebouncedWatcher {
  /**
   * @param {string} path        Directory or file path handed to `fs.watch`.
   * @param {object} [options]
   * @param {number} [options.debounceMs=100]  Window during which duplicate
   *     events for the same path are collapsed.
   * @param {function(number): void} [options.clock]  Fake clock for tests.
   *     Receives the scheduled fire time in ms; the test advances its own
   *     notion of "now" and calls `flush()` to drain due timers. When omitted,
   *     real `setTimeout` is used.
   * @param {function(string, string): void} [options.handler]  Called as
   *     `handler(path, eventType)` for every raw `fs.watch` event. Useful for
   *     debugging or logging; not required.
   */
  constructor(path, options = {}) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('path must be a non-empty string');
    }
    const debounceMs = options.debounceMs ?? 100;
    if (typeof debounceMs !== 'number' || !Number.isFinite(debounceMs) || debounceMs < 0) {
      throw new TypeError('debounceMs must be a finite, non-negative number');
    }
    this._debounceMs = debounceMs;
    this._clock = typeof options.clock === 'function' ? options.clock : null;
    this._rawHandler = typeof options.handler === 'function' ? options.handler : null;
    this._path = path;
    this._watcher = null;
    this._onChange = null;
    this._stop = null;
  }

  /**
   * Begin watching. `onChange` is called once per path per debounce window
   * with the resolved filename. Returns a no-argument stop function.
   *
   * @param {function(string): void} onChange
   * @returns {function(): void} stop
   */
  start(onChange) {
    if (typeof onChange !== 'function') {
      throw new TypeError('onChange must be a function');
    }
    if (this._stop) return this._stop;

    this._onChange = onChange;
    const debounced = debounceEvents(onChange, {
      windowMs: this._debounceMs,
      clock: this._clock,
    });

    const fs = require('node:fs');
    const watcher = fs.watch(this._path, (eventType, filename) => {
      if (this._rawHandler) {
        try { this._rawHandler(filename, eventType); } catch { /* raw handler is best-effort */ }
      }
      if (typeof filename === 'string' && filename.length > 0) {
        debounced(filename);
      }
    });
    this._watcher = watcher;

    const stop = () => {
      if (this._stop !== stop) return;
      this._stop = null;
      try { watcher.close(); } catch { /* already closed */ }
      this._watcher = null;
      this._onChange = null;
      if (typeof debounced.cancel === 'function') debounced.cancel();
    };
    this._stop = stop;
    return stop;
  }

  /**
   * Stop watching if started. Safe to call when not started or already stopped.
   */
  stop() {
    if (this._stop) this._stop();
  }
}

/**
 * `require` inside an ESM module keeps the zero-dependency promise: we pull
 * only from Node's standard library, never from node_modules. Using the
 * synchronous form here is fine because `fs.watch` itself is synchronous to
 * set up and we are not on a hot path.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
