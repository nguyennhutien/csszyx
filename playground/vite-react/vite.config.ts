import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import csszyx from 'csszyx/vite';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    // IMPORTANT: csszyx must run BEFORE react plugin AND tailwindcss
    // csszyx transforms sz="" to className="" BEFORE JSX transformation
    // This allows Tailwind to scan the generated className strings
    ...csszyx({
      development: {
        debug: true,
      },
      production: {
        injectChecksum: true,
      },
    }),
    tailwindcss(),
    react(),
  ],
});
