import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import csszyx from 'csszyx/vite';
import { defineConfig } from 'vite';

// React 17 smoke test. @vitejs/plugin-react uses the automatic JSX runtime
// (react/jsx-runtime), which exists in React 17 — the floor this playground
// guards. csszyx must run BEFORE the react plugin so sz="" is rewritten to
// className="" before JSX is transformed.
export default defineConfig({
  plugins: [...csszyx(), tailwindcss(), react()],
});
