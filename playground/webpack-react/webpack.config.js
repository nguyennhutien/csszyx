import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import csszyx from 'csszyx/webpack';
import { fileURLToPath } from 'url';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  entry: './src/index.tsx',
  mode: 'production',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'typescript',
                  tsx: true,
                },
                transform: {
                  react: {
                    runtime: 'automatic',
                  },
                },
              },
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: '!!html-loader!./src/index.html',
    }),
    new MiniCssExtractPlugin(),
    csszyx(),
  ],
  performance: {
    hints: false, // Tắt cảnh báo hoặc có thể dùng 'warning'
    maxEntrypointSize: 512000, // Nâng lên 512KB
    maxAssetSize: 512000,
  },
};

export default config;
