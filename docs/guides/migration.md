# Migrating from Tailwind CSS

CSSzyx provides a powerful CLI tool to automatically migrate your existing Tailwind CSS projects. This tool converts your `className` attributes into type-safe `sz` prop objects.

## Using the Migration CLI

The CLI parses your codebase, identifies Tailwind classes, and generates the equivalent `sz` prop logic.

### 1. Run the Migration

Run the migration command on your project directory:

```bash
npx csszyx migrate ./src
```

### 2. Options

| Option                | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `--dry-run`           | Preview changes without modifying files (recommended first step). |
| `--verbose`           | Show detailed logs of every transformation.                       |
| `--exclude <pattern>` | Glob pattern to exclude specific files (e.g. `**/*.test.tsx`).    |

### 3. Review Changes

The CLI will modify your files in place (unless `--dry-run` is used).

**Before:**

```tsx
<div className="p-4 bg-red-500 hover:bg-red-600">
  <span className="text-white font-bold">Hello</span>
</div>
```

**After:**

```tsx
<div sz={{ p: 4, bg: "red-500", hover: { bg: "red-600" } }}>
  <span sz={{ color: "white", fontWeight: "bold" }}>Hello</span>
</div>
```

## Manual Migration

If you prefer to migrate manually or have complex dynamic classes, use the recommended mapping patterns:

- **Padding/Margin**: `p-4` -> `p: 4`, `mx-2` -> `mx: 2`
- **Colors**: `bg-red-500` -> `bg: 'red-500'`, `text-white` -> `color: 'white'`
- **Layout**: `flex` -> `flex: true`, `grid` -> `display: 'grid'`
- **Font**: `font-bold` -> `fontWeight: 'bold'`
- **Modifiers**: `hover:` -> `hover: { ... }`, `md:` -> `md: { ... }`

> **Note**: Always verify the changes after running the CLI, especially for complex string template literals.
