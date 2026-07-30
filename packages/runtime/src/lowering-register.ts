/**
 * Side-effecting registration entry, published as `@csszyx/runtime/lowering`.
 *
 * A bare `import '@csszyx/runtime/lowering'` makes the string helpers
 * object-capable. The bundler plugin injects it automatically into every file
 * where an sz object can reach a helper at runtime; outside the plugin
 * pipeline (unit tests, scripts) add it once at startup.
 *
 * This is deliberately its own entry, imported by NO other source module: the
 * top-level call below is a real side effect, and if it sat inside the barrel
 * graph it would be retained for every consumer, welding the compiler onto
 * imports that never touch an object. `package.json#sideEffects` names this
 * entry's dist files so bundlers keep the bare import.
 *
 * @module @csszyx/runtime/lowering (entry)
 */

import { registerSzLowering } from './lowering.js';

registerSzLowering();
