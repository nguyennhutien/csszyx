import { transformSourceCode } from '@csszyx/compiler';

/** @type {import('tailwindcss').Config} */
export default {
  content: {
    files: [
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    transform: {
      tsx: (content) => transformSourceCode(content).code,
      ts: (content) => transformSourceCode(content).code,
    }
  },
  theme: {
    extend: {},
  },
  plugins: [],
}
