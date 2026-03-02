# CSSzyx Playgrounds

E2E testing environments for validating the complete CSSzyx pipeline.

## Available Playgrounds

### [vite-react](./vite-react/)

- **Framework**: React 18 + Vite 5
- **Purpose**: Test JSX transformation, HMR, basic mangling
- **Key Features**:
  - Counter with state management
  - Conditional styling
  - Complex grid layouts
  - Tailwind utilities

Usage:

```bash
cd playground/vite-react
pnpm install
pnpm dev
```

## Verification Checklist

For each playground:

- [ ] Classes are mangled in DOM (.z, .y instead of .p-4, .bg-red-500)
- [ ] CSS file contains mangled selectors
- [ ] `data-sz-checksum` attribute present in HTML
- [ ] Mangle map dashboard accessible at `http://localhost:5174`
- [ ] HMR updates classes in real-time
- [ ] No runtime errors in console

## Dashboard

The mangle map visualizer runs independently:

```bash
cd packages/dev-tools
pnpm dev
```

Visit `http://localhost:5174` to see:

- Total classes mangled
- Build time statistics
- Searchable mangle map table
- Tier visualization
- Export to JSON
