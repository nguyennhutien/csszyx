# @csszyx/e2e

> End-to-end tests for csszyx playgrounds using Playwright.

Ensures that csszyx works correctly in real browser environments, verifying:

- Class name extraction.
- Mangling correctness.
- SSR hydration safety.
- Dynamic styling updates.

## Running Tests

1. **Install dependencies**:

   ```bash
   pnpm install
   ```

2. **Install Playwright browsers**:

   ```bash
   pnpm exec playwright install
   ```

3. **Run tests**:

   ```bash
   pnpm exec playwright test
   ```

   Or run for a specific project:

   ```bash
   pnpm exec playwright test --project=vite-react
   ```

## License

MIT © [csszyx contributors](https://github.com/nguyennhutien/csszyx)
