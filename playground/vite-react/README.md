# CSSzyx - Vite + React Playground

Comprehensive E2E testing environment for CSSzyx class mangling.

## Features Tested

- ✅ JSX `sz` prop transformation → mangled classes
- ✅ Conditional class binding
- ✅ State management (useState with counter)
- ✅ Complex Tailwind utilities (gradients, grid, shadows)
- ✅ HMR (Hot Module Replacement)
- ✅ CSS output verification

## Quick Start

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Visit: http://localhost:5173
# Dashboard: http://localhost:5174 (mangle map visualizer)
```

## Test Cases

### 1. Counter Test

- Tests state management with `sz` prop
- Buttons use hover states and transitions
- Validates class transformation on re-render

### 2. Conditional Test

- Toggles button style based on state
- Tests ternary expression in `sz` prop
- Ensures correct class application

### 3. Complex Styles

- Grid layout with 3 columns
- Gradient backgrounds
- Hover transitions and shadows
- Multiple nested elements

## Verification

1. **Inspect Elements**: Open DevTools → Elements panel
   - Classes should be mangled (`.z`, `.y`, `.x` instead of `.p-4`, `.bg-red-500`)

2. **Check CSS Output**: Network tab → Look for CSS file
   - Should contain mangled selectors (`.z { padding: 1rem }`)

3. **Verify Checksum**: View page source
   - `<html>` tag should have `data-sz-checksum` attribute

4. **Mangle Map Dashboard**: Open `http://localhost:5174`
   - See real-time mangle map updates
   - Search for class names
   - Export to JSON

## Build

```bash
pnpm build   # Production build
pnpm preview # Preview production build
```

## Files

- `vite.config.ts` - CSSzyx plugin configuration
- `src/App.tsx` - Test component with sz prop
- `tailwind.config.js` - Tailwind CSS configuration
