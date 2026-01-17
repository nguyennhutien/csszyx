# Using AI with csszyx

csszyx is designed to be "AI-Native". Its object-based syntax is structured to be easily generated and understood by Large Language Models (LLMs). This guide explains how to get the best results when using AI tools (like GitHub Copilot, Cursor, or ChatGPT) with csszyx.

## Prompting Tips

When asking an AI to style components, you can specifically request "csszyx format" or "sz props".

**Example Prompt:**

> "Create a responsive card component using React and csszyx. use canonical keys for the sz prop."

### Key Instructions to Give AIs

If the AI doesn't know csszyx yet (or you are in a fresh context), paste this mini-primer:

```markdown
I am using a library called 'csszyx'.

- It uses a `sz` prop on HTML/React elements.
- The syntax is object-based, mapping closely to Tailwind CSS but with short keys.
- Examples:
  - `p: 4` -> `p-4`
  - `bg: 'red-500'` -> `bg-red-500`
  - `hover: { bg: 'red-600' }` -> `hover:bg-red-600`
  - `md: { w: '1/2' }` -> `md:w-1/2`
- Always prefer canonical keys (e.g. `w`, `h`, `m`, `p`, `bg`, `color`, `fontWeight`) as defined in `sz-props.ts`.
```

## IDE Configuration

### Cursor / Windsurf

We provide a `.cursorrules` file in the root of the project. If you are opening this project in Cursor, it should automatically pick up the preferences for:

- Preferring strict `SzObject` syntax.
- Using canonical camelCase keys.
- Suggesting correct variant nesting (e.g., `hover: { ... }`, `md: { ... }`).

## Context for LLMs

If you are using a chat interface (like ChatGPT or Claude), you can help the AI by providing the **Source of Truth** for props.

Files to share:

1. `packages/compiler/src/types/sz-props.ts`: This file contains all the valid keys and types.
2. `llms.txt`: A roadmap file in the root of the repo designed to help AIs navigate the project.
