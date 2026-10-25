# @csszyx/mcp-server

Model Context Protocol (MCP) server for [csszyx](https://github.com/nguyennhutien/csszyx).
It lets AI assistants (Claude, Cursor, Copilot, …) expand, validate, look up,
reverse, and migrate `sz` props directly inside your editor.

## Install

Install the server next to the compiler, at the same version, so the lockfile
pins the two together and the server answers with the rules your build uses:

```bash
npm install -D @csszyx/mcp-server
```

Requires Node.js >= 22.12.

## Configure your editor

Each setup below runs the installed binary, `csszyx-mcp`. `npx --no-install`
runs it from `node_modules/.bin` without a registry request, and installs
nothing: a project without the server gets an error, never a release it has not
installed.

### Claude Code

Add `.mcp.json` to the project root:

```json
{
  "mcpServers": {
    "csszyx": {
      "command": "npx",
      "args": ["--no-install", "csszyx-mcp"]
    }
  }
}
```

or run `claude mcp add csszyx -- npx --no-install csszyx-mcp` in the project.

### Cursor

Add the same block to `.cursor/mcp.json` in the project root.

### Claude Desktop

Claude Desktop starts servers outside any project, so give the binary's
absolute path in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "csszyx": {
      "command": "/path/to/your-app/node_modules/.bin/csszyx-mcp"
    }
  }
}
```

For a client that cannot run a project's binary, pin the version your
compiler has and read the npm cache first:
`npx --prefer-offline -y @csszyx/mcp-server@<version>`.

The server speaks MCP over stdio, so any MCP-compatible client runs the same
command.

The server answers with the `@csszyx/compiler` it was installed with. Every
tool reply names it in `_meta.compilerVersion`, beside the project's in
`_meta.projectCompilerVersion`; when the two differ, the reply opens with a line
saying so, and the server's instructions say it at startup.

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
