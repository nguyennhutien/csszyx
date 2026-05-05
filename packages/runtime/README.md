# @csszyx/runtime

Runtime package for CSSzyx - provides zero-allocation className helpers, recovery token verification, and hydration guards.

## Features

- **Zero-Allocation Helpers**: Efficient className concatenation with `_sz()` and variants
- **Token Verification**: Runtime validation of recovery tokens
- **Hydration Guards**: SSR/CSR consistency with abort protocol
- **Type Safety**: Full TypeScript support with strict types

## Installation

```bash
pnpm add @csszyx/runtime
```

## Usage

### Basic Concatenation

```typescript
import { _sz } from "@csszyx/runtime";

// Basic usage
const className = _sz("a", "b", "c");
// Returns: "a b c"

// With conditionals
const className = _sz("base", isActive && "active", hasError && "error");
// Returns: "base active" (if isActive is true, hasError is false)

// Filters out falsy values
const className = _sz("a", null, "b", undefined, false, "c");
// Returns: "a b c"
```

### Conditional Helpers

```typescript
import { _szIf, _szSwitch } from "@csszyx/runtime";

// Simple conditional
_szIf(isActive, "active"); // "active" or false

// With fallback
_szIf(isActive, "active", "inactive"); // "active" or "inactive"

// Switch-like
_szSwitch(
  [
    [status === "success", "text-green-500"],
    [status === "error", "text-red-500"],
    [status === "warning", "text-yellow-500"],
  ],
  "text-gray-500",
);
```

### Merging Classes

```typescript
import { _szMerge } from "@csszyx/runtime";

// Merge with duplicate removal
_szMerge("a b", "b c", "c d");
// Returns: "a b c d"
```

### Runtime Initialization

```typescript
import { initRuntime } from "@csszyx/runtime";

// Initialize at app startup
initRuntime({
  development: process.env.NODE_ENV === "development",
  strictHydration: true,
  debug: false,
});
```

Per-element CSR recovery is opted in via the `szRecover` JSX attribute
on individual elements (`"csr"` or `"dev-only"`) rather than a global
runtime flag. See `@csszyx/runtime/verify` for token verification helpers.

### Recovery Token Verification

```typescript
import { verifyRecoveryToken, loadManifestFromDOM } from "@csszyx/runtime";

// Load manifest from embedded script
const manifest = loadManifestFromDOM();

if (manifest) {
  const element = document.querySelector("[data-sz-recovery-token]");
  const result = verifyRecoveryToken(element, manifest);

  if (result.valid) {
    console.log("Token verified:", result.tokenData);
  } else {
    console.error("Invalid token:", result.error);
  }
}
```

### Hydration Guard

```typescript
import {
  guardHydration,
  loadManifestFromDOM,
  enableCSRRecovery,
} from "@csszyx/runtime";

// Enable CSR recovery in development
if (process.env.NODE_ENV === "development") {
  enableCSRRecovery();
}

// Guard hydration process
const manifest = loadManifestFromDOM();
if (manifest && !guardHydration(manifest)) {
  console.error("Hydration guard failed - mangle map mismatch");
}
```

## API Reference

### Concatenation Helpers

#### `_sz(...classes): string`

Zero-allocation className concatenation. Filters out falsy values.

#### `_sz2(a, b): string`

Optimized two-argument version.

#### `_sz3(a, b, c): string`

Optimized three-argument version.

#### `_szIf(condition, className, fallback?): string | false`

Conditional className application.

#### `_szSwitch(conditions, default?): string`

Switch-like className selection.

#### `_szMerge(...classes): string`

Merge className strings with duplicate removal.

### Verification

#### `verifyRecoveryToken(element, manifest): VerificationResult`

Verifies a recovery token against the manifest.

#### `loadManifestFromDOM(): RecoveryManifest | null`

Loads the recovery manifest from the DOM.

#### `hasRecoveryToken(element): boolean`

Checks if an element has a recovery token.

#### `getRecoveryMode(element): RecoveryMode | null`

Gets the recovery mode from an element.

#### `verifyAllTokens(root, manifest): VerificationResult[]`

Verifies all tokens in a subtree.

### Hydration

#### `guardHydration(manifest): boolean`

Guards the hydration process by verifying mangle map integrity.

#### `loadMangleMapFromDOM(): MangleMap | null`

Loads the mangle map from the DOM.

#### `verifyMangleChecksum(expectedChecksum): boolean`

Verifies the mangle map checksum.

#### `abortHydration(element, error): void`

Executes the hydration abort protocol for a subtree.

#### `isHydrationAborted(element): boolean`

Checks if a subtree has been aborted.

#### `attemptCSRRecovery(element): boolean`

Attempts client-side recovery for an aborted subtree.

#### `enableCSRRecovery(): void`

Enables CSR recovery mode (development only).

#### `disableCSRRecovery(): void`

Disables CSR recovery mode.

#### `isCSRRecoveryAllowed(): boolean`

Checks if CSR recovery is allowed.

#### `getHydrationErrors(): HydrationError[]`

Gets all hydration errors.

#### `getAbortedSubtreeCount(): number`

Gets the count of aborted subtrees.

### Runtime Initialization

#### `initRuntime(config?): void`

Initializes the CSSzyx runtime with optional configuration.

#### `getRuntimeConfig(): RuntimeConfig`

Gets the current runtime configuration.

#### `isRuntimeInitialized(): boolean`

Checks if the runtime has been initialized.

## Configuration Options

```typescript
interface RuntimeConfig {
  development?: boolean; // Enable development mode features
  strictHydration?: boolean; // Enable strict hydration checks
  debug?: boolean; // Enable debug logging
}
```

## Performance

The `_sz()` family of functions are optimized for zero-allocation concatenation:

- `_sz()` - Variadic version for any number of arguments
- `_sz2()` - 10-15% faster for exactly 2 arguments
- `_sz3()` - 10-15% faster for exactly 3 arguments

Use the optimized versions in hot paths when the argument count is known at compile time.

## License

MIT
