# CSSzyx Documentation

Official documentation for CSSzyx, built with VitePress.

## Development

### Install Dependencies

From the monorepo root:

```bash
pnpm install
```

### Start Dev Server

```bash
cd docs
pnpm dev
```

The documentation site will be available at [http://localhost:5173](http://localhost:5173).

### Build for Production

```bash
pnpm build
```

Output will be in `docs/.vitepress/dist`.

### Preview Production Build

```bash
pnpm preview
```

## Structure

```
docs/
├── .vitepress/
│   └── config.ts          # VitePress configuration
├── guide/
│   ├── what-is-csszyx.md  # Introduction
│   ├── getting-started.md # Quick start guide
│   ├── installation.md    # Installation guide
│   ├── object-syntax.md   # Object syntax guide
│   ├── runtime-helpers.md # Runtime helpers guide
│   ├── build-pipeline.md  # Build pipeline docs
│   └── ssr-safety.md      # SSR safety guide
├── api/
│   ├── compiler.md        # Compiler API reference
│   ├── runtime.md         # Runtime API reference
│   └── types.md           # Types API reference
├── examples/
│   ├── vite-react.md      # Vite + React example
│   └── nextjs.md          # Next.js example
├── config/
│   ├── overview.md        # Configuration overview
│   ├── development.md     # Development config
│   └── production.md      # Production config
├── index.md               # Homepage
└── package.json
```

## Writing Documentation

### Markdown Features

VitePress supports:

- GitHub-flavored Markdown
- Syntax highlighting
- Custom containers
- Table of contents
- Emoji :tada:

### Code Blocks

Use syntax highlighting:

\`\`\`tsx
import { \_sz } from '@csszyx/runtime';

function Component() {
return <div className={\_sz('p-4', 'bg-red-500')} />;
}
\`\`\`

### Custom Containers

Highlight important information:

::: tip
This is a tip
:::

::: warning
This is a warning
:::

::: danger
This is a danger notice
:::

### Links

Internal links are automatically detected:

- Relative: `[Getting Started](./getting-started.md)`
- Absolute: `[API Reference](/api/runtime)`

### Images

Place images in `docs/public/`:

```md
![Alt text](/images/example.png)
```

## Contributing

### Adding a New Page

1. Create markdown file in appropriate directory
2. Update sidebar in `.vitepress/config.ts`
3. Test locally with `pnpm dev`
4. Submit PR

### Style Guide

- Use **bold** for emphasis
- Use `code` for inline code
- Use code blocks for examples
- Keep paragraphs concise
- Use headings hierarchically (h2 → h3 → h4)

### Code Examples

- Provide complete, runnable examples
- Include TypeScript types
- Add comments for clarity
- Show both input and output when relevant

### API Documentation

Follow this structure:

```md
## FunctionName

Brief description.

**Signature:**
\`\`\`ts
function name(param: Type): ReturnType
\`\`\`

**Parameters:**

- `param` - Description

**Returns:**
Description of return value

**Example:**
\`\`\`tsx
// Example code
\`\`\`
```

## Deployment

Documentation can be deployed to:

- Vercel
- Netlify
- GitHub Pages
- Any static hosting

### GitHub Pages

1. Build the docs:

```bash
pnpm build
```

2. Deploy `.vitepress/dist` directory

### Vercel

1. Connect repository
2. Set build command: `pnpm build`
3. Set output directory: `docs/.vitepress/dist`

## Resources

- [VitePress Documentation](https://vitepress.dev/)
- [Markdown Guide](https://www.markdownguide.org/)
- [Vue 3 in Markdown](https://vitepress.dev/guide/using-vue)

## License

MIT © 2024-present csszyx contributors
