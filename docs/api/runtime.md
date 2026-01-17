# Runtime API

The `@csszyx/runtime` package provides runtime helpers for className composition, token verification, and hydration guards.

## Full vs Lite Runtime

csszyx provides two runtime entry points:

| Feature            | Full (`@csszyx/runtime`) | Lite (`csszyx/lite`) |
| ------------------ | ------------------------ | -------------------- |
| `_sz()`            | Yes                      | Yes (string-only)    |
| `_sz2()`           | Yes                      | Yes                  |
| `_sz3()`           | Yes                      | No                   |
| `_szIf()`          | Yes                      | Yes (string-only)    |
| `_szSwitch()`      | Yes                      | No                   |
| `_szMerge()`       | Yes                      | No                   |
| `__szColorVar()`   | No                       | Yes                  |
| `SzObject` support | Yes (via compiler)       | No (strings only)    |
| SSR hydration      | Yes                      | No                   |
| Token verification | Yes                      | No                   |
| Size (gzipped)     | ~3KB                     | <400B                |

Use the **lite** runtime when bundle size is critical. It only accepts pre-compiled strings (no `SzObject` transform at runtime). Use the **full** runtime for SSR applications or when you need runtime `SzObject` support.

## Concatenation Helpers

### `_sz()`

Zero-allocation className concatenation. Filters out falsy values.

**Signature:**

```ts
function _sz(...classes: (string | null | undefined | false)[]): string;
```

**Example:**

```tsx
import { _sz } from "@csszyx/runtime";

// Basic usage
_sz("a", "b", "c");
// Returns: "a b c"

// With conditionals
_sz("base", isActive && "active", hasError && "error");
// Returns: "base active" (if isActive is true, hasError is false)

// Filters falsy values
_sz("a", null, "b", undefined, false, "c");
// Returns: "a b c"
```

### `_sz2()` and `_sz3()`

Optimized variants for exactly 2 or 3 arguments. Use in hot paths for 10-15% performance gain.

**Signatures:**

```ts
function _sz2(a: string, b: string): string;
function _sz3(a: string, b: string, c: string): string;
```

**Example:**

```tsx
// In performance-critical code
_sz2("base-class", "modifier-class");
_sz3("base", "state", "variant");
```

### `_szIf()`

Conditional className application.

**Signature:**

```ts
function _szIf(
  condition: boolean,
  className: string,
  fallback?: string,
): string | false;
```

**Example:**

```tsx
import { _szIf } from "@csszyx/runtime";

// Simple conditional
_szIf(isActive, "active");
// Returns: "active" if isActive is true, false otherwise

// With fallback
_szIf(isActive, "active", "inactive");
// Returns: "active" if isActive is true, "inactive" otherwise

// Use with _sz()
_sz("base", _szIf(isActive, "active"));
```

### `_szSwitch()`

Switch-like className selection based on multiple conditions.

**Signature:**

```ts
function _szSwitch(
  conditions: Array<[boolean, string]>,
  defaultClassName?: string,
): string;
```

**Example:**

```tsx
import { _szSwitch } from "@csszyx/runtime";

const status = "error";
const className = _szSwitch(
  [
    [status === "success", "text-green-500"],
    [status === "error", "text-red-500"],
    [status === "warning", "text-yellow-500"],
  ],
  "text-gray-500",
); // default

// Returns: "text-red-500"
```

### `_szMerge()`

Merges className strings, removing duplicates.

**Signature:**

```ts
function _szMerge(...classes: string[]): string;
```

**Example:**

```tsx
import { _szMerge } from "@csszyx/runtime";

_szMerge("a b c", "b c d", "c d e");
// Returns: "a b c d e" (duplicates removed, order preserved)
```

## Color Helpers

### `__szColorVar()`

Resolves a dynamic color value to a CSS-compatible string. Available from `csszyx/lite`.

Maps Tailwind color names to CSS custom properties, passes through raw CSS values.

**Signature:**

```ts
function __szColorVar(v: string): string;
```

**Example:**

```tsx
import { __szColorVar } from "csszyx/lite";

__szColorVar("blue-500"); // → 'var(--color-blue-500)'
__szColorVar("#ff0"); // → '#ff0'
__szColorVar("--my-var"); // → 'var(--my-var)'
__szColorVar("rgb(255,0,0)"); // → 'rgb(255,0,0)'
```

## Initialization

### `initRuntime()`

Initializes the csszyx runtime. Call once at application startup.

**Signature:**

```ts
function initRuntime(config?: Partial<RuntimeConfig>): void;

interface RuntimeConfig {
  development?: boolean;
  allowCSRRecovery?: boolean;
  strictHydration?: boolean;
  debug?: boolean;
}
```

**Example:**

```tsx
import { initRuntime } from "@csszyx/runtime";

initRuntime({
  development: process.env.NODE_ENV === "development",
  allowCSRRecovery: true,
  strictHydration: true,
  debug: false,
});
```

### `getRuntimeConfig()`

Gets the current runtime configuration.

**Signature:**

```ts
function getRuntimeConfig(): Required<RuntimeConfig>;
```

## Token Verification

### `verifyRecoveryToken()`

Verifies a recovery token against the manifest.

**Signature:**

```ts
function verifyRecoveryToken(
  element: HTMLElement,
  manifest: RecoveryManifest,
): VerificationResult;

interface VerificationResult {
  valid: boolean;
  tokenData?: TokenData;
  error?: string;
}
```

**Example:**

```tsx
import { verifyRecoveryToken, loadManifestFromDOM } from "@csszyx/runtime";

const manifest = loadManifestFromDOM();
const element = document.querySelector("[data-sz-recovery-token]");

if (manifest && element) {
  const result = verifyRecoveryToken(element, manifest);
  if (result.valid) {
    console.log("Token verified:", result.tokenData);
  }
}
```

### `loadManifestFromDOM()`

Loads the recovery manifest from the DOM.

**Signature:**

```ts
function loadManifestFromDOM(): RecoveryManifest | null;
```

## Hydration Guards

### `guardHydration()`

Guards the hydration process by verifying mangle map integrity.

**Signature:**

```ts
function guardHydration(manifest: RecoveryManifest): boolean;
```

**Example:**

```tsx
import { guardHydration, loadManifestFromDOM } from "@csszyx/runtime";

const manifest = loadManifestFromDOM();
if (manifest && !guardHydration(manifest)) {
  console.error("Hydration guard failed");
}
```

### `enableCSRRecovery()` / `disableCSRRecovery()`

Enable or disable client-side recovery mode (development only).

**Signature:**

```ts
function enableCSRRecovery(): void;
function disableCSRRecovery(): void;
function isCSRRecoveryAllowed(): boolean;
```

**Example:**

```tsx
import { enableCSRRecovery } from "@csszyx/runtime";

if (process.env.NODE_ENV === "development") {
  enableCSRRecovery();
}
```

### `abortHydration()`

Executes the hydration abort protocol for a subtree.

**Signature:**

```ts
function abortHydration(element: HTMLElement, error: HydrationError): void;

interface HydrationError {
  type: HydrationErrorType;
  message: string;
  timestamp: number;
}
```

### `isHydrationAborted()`

Checks if a subtree has been aborted.

**Signature:**

```ts
function isHydrationAborted(element: HTMLElement): boolean;
```

### `getHydrationErrors()`

Gets all hydration errors.

**Signature:**

```ts
function getHydrationErrors(): HydrationError[];
```

## Type Definitions

### `RecoveryManifest`

```ts
interface RecoveryManifest {
  buildId: string;
  checksum: string;
  tokens: Record<string, TokenData>;
}
```

### `TokenData`

```ts
interface TokenData {
  mode: RecoveryMode;
  component: string;
  path: string;
}

type RecoveryMode = "csr" | "dev-only";
```

### `MangleMap`

```ts
interface MangleMap {
  [originalClass: string]: string;
}
```

## Best Practices

### 1. Use Optimized Variants in Hot Paths

```tsx
// ✅ Good - Use _sz2() for exactly 2 arguments
const className = _sz2(baseClass, variantClass);

// ⚠️ Okay - Use _sz() for variable arguments
const className = _sz(baseClass, ...conditionalClasses);
```

### 2. Initialize Runtime Once

```tsx
// ✅ Good - Initialize in app entry point
// main.tsx or _app.tsx
initRuntime({ ... });

// ❌ Bad - Don't initialize in components
function Component() {
    initRuntime({ ... }); // ❌ Don't do this
}
```

### 3. Leverage \_szSwitch for Multiple Conditions

```tsx
// ✅ Good - Use _szSwitch for clarity
_szSwitch(
  [
    [status === "success", "text-green-500"],
    [status === "error", "text-red-500"],
  ],
  "text-gray-500",
);

// ⚠️ Okay but verbose
status === "success"
  ? "text-green-500"
  : status === "error"
    ? "text-red-500"
    : "text-gray-500";
```

## See Also

- [Compiler API](/api/compiler)
- [Types API](/api/types)
- [Runtime Helpers Guide](/guide/runtime-helpers)
