/**
 * Path-keyed debouncer. Events arriving for the same path within `windowMs`
 * collapse into a single trailing notification.
 *
 * Design decisions, each tested:
 *   - Trailing edge only. Leading-edge delivery would fire on the first event
 *     of a burst, which is the opposite of what "collapse duplicates" asks for.
 *   - Per-path timers, not a single shared timer. A shared timer would delay
 *     path B's notification until path A's window expired, which is wrong.
 *   - The `clock(ms)` callback, when provided, replaces `setTimeout`. Tests
 *     pass a fake clock that records the requested fire time; the test then
 *     calls `flush(now)` to fire whatever is due. This makes every test
 *     deterministic regardless of machine speed.
 *   - `cancel()` clears every pending timer so `DebouncedWatcher.stop()` is
 *     clean even mid-burst.
 *
 * @param {function(string): void} fn      Receives the debounced path.
 * @param {object} options
 * @param {number} options.windowMs
 * @param {function(number): void} [options.clock]  Receives the absolute ms
 *     at which the timer should fire. Implementations may ignore the argument
 *     and use their own scheduler; tests use it to know what to advance to.
 * @returns {function(string): void & { cancel(): void, flush(): void }}
 */
export default function debounceEvents(fn, options) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  const windowMs = options?.windowMs;
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs < 0) {
    throw new TypeError('options.windowMs must be a finite, non-negative number');
  }
  const clock = typeof options?.clock === 'function' ? options.clock : null;

  const timers = new Map();
  const pending = new Map();

  const wrapped = (path) => {
    if (typeof path !== 'string' || path.length === 0) return;
    if (timers.has(path)) {
      pending.set(path, path);
      return;
    }
    pending.set(path, path);
    const fire = () => {
      timers.delete(path);
      const value = pending.get(path);
      pending.delete(path);
      if (value !== undefined) fn(value);
    };
    if (clock) {
      clock(windowMs);
      timers.set(path, { fire });
    } else {
      const id = setTimeout(fire, windowMs);
      if (typeof id === 'object' && id && typeof id.unref === 'function') id.unref();
      timers.set(path, { fire, id });
    }
  };

  wrapped.cancel = () => {
    for (const entry of timers.values()) {
      if (entry.id !== undefined) {
        clearTimeout(entry.id);
      }
    }
    timers.clear();
    pending.clear();
  };

  /**
   * Synchronously fire every timer that a fake clock has marked as due.
   * Only meaningful when `clock` was provided; with real `setTimeout` this
   * is a no-op because Node owns the schedule.
   */
  wrapped.flush = () => {
    if (!clock) return;
    const due = [];
    for (const [path] of timers) due.push(path);
    for (const path of due) {
      const entry = timers.get(path);
      if (entry) entry.fire();
    }
  };

  return wrapped;
}
