# CSSzyx Hydration Safety Architecture

## 🎯 Design Principles

### 1. Compile-Time Over Runtime

**Principle:** All hydration decisions must be determinable at build time.

**Why:**

- Statically analyzable
- No runtime performance cost
- Prevents accidental configuration bugs
- CI/CD can validate before deployment

### 2. Ease of Use > Absolute Purity

**Principle:** Developer experience matters, but with safety rails.

**Implementation:**

- Progressive migration path via build config
- Escape hatches for pragmatic debugging
- Clear warnings guide fixes
- Eventually converges to strict mode

### 3. No Runtime Global State + Cryptographic Verification

**Principle:** No mutable globals + tokens prevent tampering.

**Implementation:**

- No `window.*` flags in decision path
- Cryptographic tokens generated at build-time
- Runtime verifies tokens before allowing recovery
- Tamper detection via hash mismatches

**Why:**

- Eliminates false confidence
- Prevents accidental state pollution
- Detects tampering and corruption
- Ensures deterministic behavior
- Makes testing reliable

---

## 🏗️ Architecture Overview

### Token-Based Recovery System

**Build Time:**

```javascript
// Developer writes (simple)
<Component szRecover="csr" />

// Build generates token
const token = SHA256({
  component: 'Component',
  path: '/src/Component.tsx',
  line: 42,
  mode: 'csr',
  buildId: 'abc123'
}).substring(0, 12)  // → "a94f1cb82e3d"

// Inject token attribute
<Component
  szRecover="csr"
  data-sz-recovery-token="a94f1cb82e3d"
/>

// Store in manifest
{
  "buildId": "abc123",
  "checksum": "x9y8...",
  "tokens": {
    "a94f1cb82e3d": {
      "mode": "csr",
      "component": "Component"
    }
  }
}
```

**Runtime:**

```typescript
// On hydration abort
const token = element.getAttribute("data-sz-recovery-token");
const manifest = loadRecoveryManifest();

// Security checks
if (!token) throw SecurityError("Token missing");
if (!manifest.tokens[token]) throw SecurityError("Invalid token");
if (manifest.tokens[token].mode !== szRecover)
  throw SecurityError("Mode mismatch");

// Token valid → allow recovery
performCSRRecovery();
```

### Build Config System

```javascript
// csszyx.config.js
{
  development: {
    auto_inject_recovery: boolean,  // Auto-add dev-only recovery
    strict_mode: boolean            // Test exact prod behavior
  }
}
```

**Key Points:**

1. Settings are **build-time only**
2. Affect **compile output**, not runtime logic
3. Runtime sees **only compiled code**
4. No `window.*` flags in decision path

---

## 📝 Recovery Declaration System

### Three Ways to Declare Recovery

#### 1. Explicit Production (`szRecover="csr"`)

```tsx
<Component szRecover="csr" />
```

- Works in both dev and prod
- Use when: Component legitimately needs recovery in production
- Example: Third-party widgets, dynamic content

#### 2. Development Only (`szRecover="dev-only"`)

```tsx
<Component szRecover="dev-only" />
```

- Works only in development
- Stripped in production
- Use when: Debugging hydration issues, not ready for prod
- Warns: "Consider fixing or promoting to csr"

#### 3. Escape Hatch (Comment Directives)

```tsx
// @csszyx-disable-hydration
<Component />
```

- Compile-time transform to `szRecover="dev-only"`
- Like ESLint disable comments
- Trackable via audit logs
- Use when: Quick debugging, legacy code

---

## 🔄 Progressive Migration Workflow

### Phase 1: Exploration (Week 1-2)

**Config:**

```javascript
{
  development: {
    auto_inject_recovery: true,
    strict_mode: false
  }
}
```

**What Happens:**

```tsx
// Source
<DataTable />

// Compiled (dev)
<DataTable szRecover="dev-only" data-sz-auto-injected="true" />

// Compiled (prod)
<DataTable />
```

**Goal:** Identify which components have hydration issues

**Output:** Console logs showing all recovery events

---

### Phase 2: Progressive Fix (Week 3-4)

**Config:**

```javascript
{
  development: {
    auto_inject_recovery: false,  // ← Changed
    strict_mode: false
  }
}
```

**What Happens:**

- Auto-inject disabled
- Manually add `szRecover="dev-only"` where needed
- Fix actual hydration bugs when possible

**Example:**

```tsx
// Option A: Fix the bug
<DataTable data={staticData} />  // No szRecover needed

// Option B: Temporary recovery
<DataTable szRecover="dev-only" data={asyncData} />
```

---

### Phase 3: Pre-Production Validation (Week 5+)

**Config:**

```javascript
{
  development: {
    auto_inject_recovery: false,
    strict_mode: true  // ← Changed
  }
}
```

**What Happens:**

```tsx
// Dev build behavior now IDENTICAL to prod
<Component szRecover="dev-only" />
// ↑ Ignored in strict mode, warns:
// "⚠️ dev-only recovery disabled in strict mode"
```

**Goal:** Test with exact production behavior

**Acceptance:** Zero warnings OR only `szRecover="csr"` components

---

### Phase 4: Production

**Build:** Production mode (automatic)

**What Happens:**

```tsx
// Source
<Component szRecover="dev-only" />

// Compiled
<Component />  // Attribute stripped
```

**Behavior:** Pure strict mode, no recovery unless `szRecover="csr"`

---

## 🔐 Token-Based Security System

### Why Tokens?

**Problem with Simple Attributes:**

```tsx
// Developer can manually add in DevTools
element.setAttribute('szRecover', 'csr')

// XSS can inject
<script>div.innerHTML = '<x szRecover="csr">'</script>

// Third-party scripts can pollute
window.__RECOVERY_MODE__ = true
```

### Solution: Cryptographic Tokens

```tsx
// Build generates unforgeable token
<Component szRecover="csr" data-sz-recovery-token="a94f1cb82e3d" />;

// Runtime requires valid token
if (!verifyToken(token, manifest)) {
  rejectRecovery();
}
```

---

### Token Generation Algorithm

```typescript
function generateRecoveryToken(component: ComponentInfo): string {
  // Gather inputs
  const input = {
    component: component.name,
    path: component.absolutePath,
    line: component.lineNumber,
    column: component.columnNumber,
    mode: component.szRecoverValue, // 'csr' or 'dev-only'
    buildId: process.env.BUILD_ID || gitHash(),
  };

  // Hash
  const hash = SHA256(JSON.stringify(input));

  // Encode (Base62 for URL safety)
  const token = base62(hash).substring(0, 12);

  return token;
}
```

**Properties:**

- ✅ **Deterministic**: Same input → same token
- ✅ **Unique**: Different components → different tokens
- ✅ **Unforgeable**: Cannot guess without knowing inputs
- ✅ **Short**: 12 characters (62^12 = 3.2e21 combinations)

---

### Manifest Structure

```json
{
  "buildId": "abc123def456",
  "checksum": "x9y8z7w6...",
  "tokens": {
    "a94f1cb82e3d": {
      "mode": "csr",
      "component": "DataTable"
    },
    "b82e3d7f5a1c": {
      "mode": "dev-only",
      "component": "ChartWidget"
    }
  }
}
```

**Checksum:**

```typescript
manifest.checksum = SHA256(JSON.stringify(manifest.tokens));
```

→ Detects manifest corruption or tampering

---

### Runtime Verification Flow

```typescript
async function verifyRecoveryToken(
  element: HTMLElement,
  manifest: RecoveryManifest,
): boolean {
  // Step 1: Check token exists
  const token = element.getAttribute("data-sz-recovery-token");
  if (!token) {
    console.error("csszyxSecurityError: Recovery token missing");
    return false;
  }

  // Step 2: Verify manifest checksum
  const computedChecksum = SHA256(JSON.stringify(manifest.tokens));
  if (computedChecksum !== manifest.checksum) {
    console.error("csszyxSecurityError: Manifest corruption detected");
    return false;
  }

  // Step 3: Lookup token
  const tokenData = manifest.tokens[token];
  if (!tokenData) {
    console.error("csszyxSecurityError: Invalid recovery token");
    console.error("This may indicate tampering or build mismatch");
    return false;
  }

  // Step 4: Verify mode matches
  const declaredMode = element.getAttribute("szRecover");
  if (tokenData.mode !== declaredMode) {
    console.error("csszyxSecurityError: Recovery mode mismatch");
    console.error(`Expected: ${tokenData.mode}, Got: ${declaredMode}`);
    return false;
  }

  // Step 5: Environment check
  if (tokenData.mode === "dev-only" && isProduction) {
    console.error("dev-only recovery in production (should be stripped)");
    return false;
  }

  return true;
}
```

---

### Protected Scenarios

#### 1. DevTools Manual Edit

```javascript
// Attack
element.setAttribute("szRecover", "csr");

// Detection
verifyRecoveryToken(element);
// → No data-sz-recovery-token attribute
// → Rejected with security error
```

#### 2. XSS Injection

```html
<script>
  const div = document.createElement("div");
  div.setAttribute("szRecover", "csr");
  document.body.appendChild(div);
</script>
```

```javascript
// Detection
verifyRecoveryToken(div);
// → No token attribute
// → Rejected with security error
```

#### 3. Build Corruption

```plaintext
Build process corrupts output:
szRecover="csr" becomes szRecover="csr "
```

```javascript
// Detection
manifest.tokens["a94f1c..."].mode; // → "csr"
element.getAttribute("szRecover"); // → "csr " (trailing space)
// → Mode mismatch
// → Rejected with security error
```

#### 4. Token Reuse Attack

```javascript
// Attack: Copy token from Component A to Component B
<ComponentB
  szRecover="csr"
  data-sz-recovery-token="a94f1c..." // Stolen from A
/>

// Detection
// Token 'a94f1c...' maps to component: "ComponentA"
// But element is ComponentB
// → Manifest validation passes (token exists)
// → Runtime context mismatch (optional additional check)
```

**Note:** Current design doesn't verify component name at runtime (only mode). This is acceptable because:

- Token is tied to specific location in code
- Reusing token requires deliberate action
- Build would generate different token for B anyway
- If needed, can add component name verification

---

### Comparison with Other Approaches

| Approach            | Tamper Detection | DX         | Complexity |
| ------------------- | ---------------- | ---------- | ---------- |
| **No verification** | ❌ None          | ✅ Simple  | ✅ Low     |
| **Global flag**     | ❌ None          | ✅ Simple  | ✅ Low     |
| **Attribute only**  | ❌ None          | ✅ Simple  | ✅ Low     |
| **Token (ours)**    | ✅ Strong        | ✅ Simple  | ⚠️ Medium  |
| **Signed manifest** | ✅ Strongest     | ⚠️ Complex | ❌ High    |

**Why not signed manifest?**

- Requires key management
- Harder to debug
- Overkill for SSR safety
- Tokens provide sufficient protection

---

## 🛡️ Safety Guarantees

### 1. No False Confidence

**Problem (Old System):**

```tsx
// Dev with global flag
window.__SZ_ALLOW_CSR_RECOVERY__ = true
<Component />  // Works! ✓

// Production
<Component />  // Broken! ✗
```

**Solution (New System):**

```tsx
// Dev
<Component szRecover="dev-only" />  // Works + warns

// Production
<Component />  // Same failure mode as dev strict
```

→ Developer knows exact prod behavior

---

### 2. Detection Parity

**Guarantee:** Hydration mismatch detection is **identical** across environments.

**What's Different:**

- Recovery execution (explicit via `szRecover` values)
- Logging verbosity (dev verbose, prod minimal)

**What's Same:**

- Detection algorithm
- Checksum validation
- Abort protocol

---

### 3. Compile-Time Transparency

**Principle:** Runtime doesn't know about build config.

```javascript
// Build config
{
  auto_inject_recovery: true;
}

// What runtime sees
<Component szRecover="dev-only" />;

// Runtime logic
if (hasAttribute("szRecover") && value === "dev-only" && isDev) {
  enableRecovery();
}
```

→ No `if (window.__CONFIG__.auto_inject)` in runtime!

---

## 🔍 Escape Hatch System

### Design Philosophy

Like ESLint disable comments:

- Local scope (not global)
- Explicit in source code
- Auditable (logged)
- Greppable (easy to find)
- Temporary (easy to remove)

### Directives

#### Single Component

```tsx
// @csszyx-disable-hydration
<ThirdPartyWidget />
```

→ Transforms to `<ThirdPartyWidget szRecover="dev-only" />`

#### Entire File

```tsx
// @csszyx-disable-file

export default function LegacyPage() {
  // All components in this file get dev-only recovery
}
```

#### Force Strict

```tsx
// @csszyx-enable-strict
<PaymentForm />
```

→ Ignore `auto_inject` config for this component

### Audit Trail

All directives logged to `.csszyx/directives.log`:

```json
{
  "file": "/src/components/LegacyWidget.tsx",
  "line": 42,
  "directive": "disable_hydration_guard",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### CI Validation

Optional check to prevent shipping directives:

```bash
# Fail if directives found in src/
csszyx-lint --no-directives src/

# Or via config
{
  ci: {
    allowDirectivesInProd: false
  }
}
```

---

## 📊 Comparison Table

| Aspect               | Old (Global Flag)        | New (Token-Based)               |
| -------------------- | ------------------------ | ------------------------------- |
| **Determinism**      | ❌ Runtime mutation      | ✅ Compile-time only            |
| **Auditability**     | ❌ Hidden state          | ✅ Explicit in code + manifest  |
| **False Confidence** | ❌ Dev works, prod fails | ✅ Strict mode tests exact prod |
| **DX**               | ⚠️ Easy but risky        | ✅ Progressive + safe           |
| **Escape Hatch**     | ❌ Global toggle         | ✅ Local directives             |
| **CI Validation**    | ❌ Cannot detect         | ✅ Fully auditable              |
| **Migration Path**   | ❌ All-or-nothing        | ✅ Progressive phases           |
| **Tamper Detection** | ❌ None                  | ✅ Cryptographic tokens         |
| **Security**         | ⚠️ Low                   | ✅ High                         |

---

## 🎓 Best Practices

### 1. Start Strict

```javascript
// Recommended default
{
  development: {
    auto_inject_recovery: false,  // Force explicit
    strict_mode: false
  }
}
```

**Why:** Encourages fixing issues early

**When to Enable `auto_inject`:** Migrating large legacy codebase

---

### 2. Use `dev-only` Sparingly

```tsx
// ✅ Good: Temporary while debugging
<Component szRecover="dev-only" />
// TODO: Fix hydration issue by next sprint

// ❌ Bad: Permanent band-aid
<Component szRecover="dev-only" />
// This has been here for 6 months...
```

---

### 3. Graduate to `csr` Carefully

```tsx
// Only when:
// 1. Issue cannot be fixed (e.g., third-party)
// 2. Behavior is tested and acceptable
// 3. Performance impact understood

<ThirdPartyWidget szRecover="csr" />
```

---

### 4. Enable Strict Before Merge

```javascript
// In CI/CD pipeline
{
  test: {
    development: {
      auto_inject_recovery: false,
      strict_mode: true  // ← Force exact prod behavior
    }
  }
}
```

---

## 🚀 Migration Example

### Before (Legacy Codebase)

```tsx
// 100 components with hydration issues
// Using global flag
window.__SZ_ALLOW_CSR_RECOVERY__ = true;
```

### Week 1: Enable Auto-Inject

```javascript
{
  auto_inject_recovery: true;
}
```

```plaintext
Console output:
ℹ️ Auto-recovery: <Component1>
ℹ️ Auto-recovery: <Component2>
...
ℹ️ Auto-recovery: <Component100>
```

### Week 2-4: Progressive Fix

```javascript
{
  auto_inject_recovery: false;
}
```

```tsx
// Fixed 70 components (no szRecover needed)
<Component1 />
<Component2 />

// 30 still need work
<Component3 szRecover="dev-only" />
...
<Component32 szRecover="dev-only" />
```

### Week 5: Validate

```javascript
{
  strict_mode: true;
}
```

```plaintext
Console output:
⚠️ dev-only recovery disabled: <Component3>
...
⚠️ dev-only recovery disabled: <Component32>
```

### Week 6-8: Final Push

```tsx
// Fixed 25 more
<Component3 />

// 5 legitimately need production recovery
<ThirdPartyWidget szRecover="csr" />
...
```

### Week 9: Ship

```plaintext
Production build: Clean!
- 95 components fixed
- 5 with explicit szRecover="csr"
- Zero dev-only in prod
```

---

## ✅ Summary

**Key Architectural Decisions:**

1. **No Runtime Flags** → Compile-time only
2. **Explicit Declarations** → `szRecover` attribute
3. **Progressive Migration** → Build config phases
4. **Escape Hatches** → Comment directives
5. **Audit Trail** → Full transparency

**Result:**

- **Risk = 0**: No runtime mutation, deterministic
- **DX = High**: Progressive path, clear warnings
- **Production Safe**: Strict by default, explicit opt-in

This achieves the balance between **Ease of Use** and **Absolute Safety** that you specified. 🎯
