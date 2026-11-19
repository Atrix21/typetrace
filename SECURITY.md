# Security

TypeTrace runs locally. It reads the repository you index, writes its index to `~/.cache/typetrace/`, writes MCP
configuration files for the AI coding tools it registers with, and downloads its embedding model once. It sends no
code anywhere.

## Reporting a vulnerability

Please report it privately through [GitHub's private vulnerability reporting](https://github.com/Atrix21/typetrace/security/advisories/new),
not in a public issue. You should get a first reply within a week. Fixes are released as a new npm version and noted
in the [changelog](CHANGELOG.md).

## Supported versions

The latest release on npm.
