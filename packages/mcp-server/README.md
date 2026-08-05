# @csszyx/mcp-server

Model Context Protocol (MCP) server for [csszyx](https://github.com/nguyennhutien/csszyx).
It lets AI assistants (Claude, Cursor, Copilot, …) expand, validate, look up,
reverse, and migrate `sz` props directly inside your editor.

## Install

```bash
# run without installing (recommended for MCP clients)
npx @csszyx/mcp-server

# or install globally
npm install -g @csszyx/mcp-server
```

Requires Node.js >= 22.12.

## Configure your editor

### Claude Desktop / Claude Code

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "csszyx": {
      "command": "npx",
      "args": ["-y", "@csszyx/mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "csszyx": {
      "command": "npx",
      "args": ["-y", "@csszyx/mcp-server"]
    }
  }
}
```

The server speaks MCP over stdio, so any MCP-compatible client uses the same
`npx @csszyx/mcp-server` command.

## Tools

| Tool                     | Purpose                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `csszyx_expand`          | Expand one `sz` object into a Tailwind class string                                             |
| `csszyx_batch`           | Expand many `sz` objects in one call                                                            |
| `csszyx_reverse`         | Convert a Tailwind class string back into an `sz` object                                        |
| `csszyx_validate`        | Validate an `sz` object; reports unknown props and CSS-name mistakes                            |
| `csszyx_lookup`          | Look up how a CSS property/keyword maps to an `sz` key                                          |
| `csszyx_migrate`         | Rewrite a JSX/TSX snippet's `className` attributes into `sz` props                              |
| `csszyx_theme`           | Parse `@theme` CSS blocks and categorize design tokens                                          |
| `csszyx_compile_preview` | Compile a whole source module and report the classes, diagnostics, and leftover runtime helpers |

## Resources

Read-only context an AI agent can load:

| URI                     | Content                                 |
| ----------------------- | --------------------------------------- |
| `csszyx://setup`        | Step-by-step project setup guide        |
| `csszyx://reference`    | Full API reference (`llms-full.txt`)    |
| `csszyx://property-map` | `PROPERTY_MAP` as JSON                  |
| `csszyx://variants`     | All known variant names as a JSON array |

## Prompts

| Prompt              | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `migrate_component` | Paste a Tailwind component and get it migrated to `sz` props |
| `create_component`  | Describe a UI component and get production-ready `sz` code   |

## License

MIT
