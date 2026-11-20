"""
`typetrace` from PyPI: runs the TypeTrace command-line tool (the npm package `typetrace-cli`, the same version as this
package) with the Node.js runtime that the `nodejs-wheel-binaries` dependency installs. No separate Node install is
needed. A Node.js 22.13 or newer already on the PATH is not used, so the version is always the one that was tested.

    uvx typetrace init .          # or: pip install typetrace && typetrace init .
    typetrace query . "where is the session token refreshed?"

The MCP entries that `typetrace init` writes start the server the way this package was started (`uvx typetrace==X
serve ...` under uvx, else this Python environment's `python -m typetrace serve ...`), so they work without Node on
the PATH.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from importlib.metadata import version

NPM_PACKAGE = "typetrace-cli"


def _version() -> str:
    return version("typetrace")


def _node_bin_dir() -> str:
    from nodejs_wheel import executable  # the bundled Node.js runtime

    return executable.ROOT_DIR if os.name == "nt" else os.path.join(executable.ROOT_DIR, "bin")


def _launch_command(v: str) -> list[str]:
    """How MCP clients should start the server, mirroring how this package was started."""
    if "archive-v" in sys.prefix and shutil.which("uvx"):
        return ["uvx", f"typetrace=={v}"]  # an ephemeral `uvx` environment: never point at its path
    return [sys.executable, "-m", "typetrace"]


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    v = _version()
    if args[:1] in (["--version"], ["version"]):
        print(v)
        return 0
    from nodejs_wheel import npx

    bin_dir = _node_bin_dir()
    env = dict(os.environ)
    # The npm package's own entry point is `#!/usr/bin/env node`: put the bundled Node first on the PATH.
    env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
    env.setdefault("TYPETRACE_LAUNCH", json.dumps(_launch_command(v)))
    # The Claude Code hook that `init` writes runs on this Node.js too (users of this package may have none on the PATH).
    env.setdefault("TYPETRACE_HOOK_NODE", os.path.join(bin_dir, "node.exe" if os.name == "nt" else "node"))
    try:
        # TYPETRACE_NPM_SPEC (testing, offline installs): another npm package spec, e.g. the path of a packed tarball.
        spec = os.environ.get("TYPETRACE_NPM_SPEC") or f"{NPM_PACKAGE}@{v}"
        return npx(["--yes", "--prefer-offline", "--package", spec, "--", "typetrace", *args], env=env)
    except KeyboardInterrupt:
        return 130
    except FileNotFoundError as e:  # pragma: no cover - a broken nodejs-wheel install
        print(f"typetrace: the bundled Node.js runtime is missing ({e}); reinstall: pip install --force-reinstall typetrace", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
