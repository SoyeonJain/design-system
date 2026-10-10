# File System Event Debouncer

Collapses rapid duplicate file change events from `fs.watch` into a single notification per path within a configurable window.

```js
import { DebouncedWatcher } from './src/index.js';

const watcher = new DebouncedWatcher('./src', { debounceMs: 100 });
watcher.start((filename) => {
  console.log('changed:', filename);
});

// later
watcher.stop();
```

## Why

`fs.watch` is cheap and event-driven, but on most platforms a single save fires two to six events (a `rename` immediately followed by several `change` events, often duplicated across editors and OSes). Triggering a recompile or reload on every one of those wastes work and flickers the output. This library debounces per path so downstream logic runs once per logical edit.

The trade-off: notifications are delivered on the **trailing edge** of the window, not the leading edge. If your consumer needs to react before the user finishes saving, this is the wrong library. Trailing-edge was chosen because "collapse duplicates" means "wait until things settle", which is the opposite of firing on the first event.

## Edge you will hit

The `eventType` argument from `fs.watch` (`'change'` / `'rename'`) is **not** forwarded. Events are grouped by filename only. If you need to distinguish a rename from a change, watch at a higher level — this library deliberately does not try to merge or interpret event types, because the mapping from OS event to semantic intent is platform-specific and a source of bugs.

`fs.watch` itself is inconsistent across platforms (Linux inotify, macOS FSEvents, Windows ReadDirectoryChangesW). This library does not smooth over those differences; it only collapses duplicates within whatever stream of events the platform produces. A `filename` of `null` (which some platforms emit for directory-level events) is dropped.

## Exports

- `DebouncedWatcher` (class) — constructor `(path, options?)` where `options.debounceMs` is the collapse window (default `100`) and `options.clock` is an optional injectable clock for testing. Methods: `start(onChange)` returns a stop function; `stop()` is also available directly.
- `debounceEvents` (function) — the underlying path-keyed debouncer, `(fn, options)` where `options.windowMs` is required and `options.clock` is optional. Returns a function with `.cancel()` and `.flush()`.

## Tests

```
node --test
```

Tests use an injectable fake clock so they never depend on wall-clock time. The one integration test that exercises real `fs.watch` asserts only that the watched path appears in the output, never on an exact event count, because platform event counts vary.
