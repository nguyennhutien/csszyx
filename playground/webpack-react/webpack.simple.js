import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  entry: './src/simple.js',
  output: {
    path: path.resolve(__dirname, 'dist-simple'),
    filename: 'simple.bundle.js',
  },
};
