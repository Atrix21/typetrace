# TypeTrace

Finds the code an AI coding agent needs: file:line pointers plus their callers and callees, from a local index of
your repository (keyword search, a local embedding model and a call graph). It is served over MCP to Claude Code,
Cursor, VS Code (GitHub Copilot), Codex, Gemini CLI, OpenCode, Kiro, Windsurf and Zed. No API keys; nothing leaves
your machine.

This is the PyPI distribution of the [`typetrace-cli`](https://www.npmjs.com/package/typetrace-cli) npm package. It
brings its own Node.js (through `nodejs-wheel-binaries`), so you need only Python:

```
uvx typetrace init .        # index the repository and register the MCP server with your AI coding tools
typetrace status .          # what is indexed, what is still running
typetrace query . "where is the session token refreshed?"
```

`init` writes MCP entries that start the server the same way (`uvx typetrace==<version> serve ...`, or this Python
environment when installed with pip). The first run downloads the npm package; the first full index downloads the
embedding model (~2.4 GB, cached).

Documentation, benchmarks and the experiments behind every claim: https://github.com/Atrix21/typetrace

<!-- MCP Registry ownership check -->
mcp-name: io.github.Atrix21/typetrace
