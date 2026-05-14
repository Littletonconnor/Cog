# just-bash Reference

Reference doc for [`just-bash`](https://github.com/vercel-labs/just-bash) — a
TypeScript bash interpreter with a virtual filesystem, built by Vercel Labs.

Researched: 2026-05-13
Last verified: 2026-05-13
Review by: 2026-06-13
Local checkout: `/Users/connorlittleton/oss/just-bash`
Upstream: `git+https://github.com/vercel-labs/just-bash.git`
Version: `just-bash` 3.0.0, beta software per package README.
License: Apache-2.0

> TL;DR: just-bash is a pure-TypeScript bash interpreter + in-memory VFS
> intended for in-process AI agent sandboxing on Node.js. It is **not a VM,
> container, or kernel sandbox**. It defends against untrusted *scripts*, not
> untrusted *hosts*. For Cog, the realistic decision is: embed it as a
> library if you want a fast, hermetic, "good-enough" bash sandbox; reach for
> bwrap/Firecracker/Vercel Sandbox the moment you need real binaries,
> compilers, package managers, or a full POSIX environment.

---

## 1. What it is, in one paragraph

just-bash parses bash scripts into an AST in TypeScript and walks that AST
with a hand-written interpreter — no `child_process`, no `vm.runInContext`,
no shell out to `bash` (CLAUDE.md:6-7, THREAT_MODEL.md:43-77). Filesystem
access is mediated by an `IFileSystem` interface with four implementations
(InMemoryFs, OverlayFs, ReadWriteFs, MountableFs) that confine all reads and
writes to a configured root. Around the interpreter is a "defense-in-depth
box" that monkey-patches dangerous JS globals (`Function`, `eval`,
`process.env`, `WebAssembly`, etc.) inside an `AsyncLocalStorage` context
(packages/just-bash/src/security/defense-in-depth-box.ts:1-30). About 79
built-in commands (`ls`, `grep`, `sed`, `awk`, `find`, `jq`, ...) are
implemented in TypeScript and run against the VFS. Network, Python, and
JS-exec are opt-in capability surfaces with their own isolation strategies.

---

## 2. Repo layout (HIGH confidence)

```
just-bash/                                root
├─ README.md                              monorepo readme
├─ CLAUDE.md                              architecture + invariants
├─ THREAT_MODEL.md                        38KB threat model (read this)
├─ packages/
│  ├─ just-bash/                          the library + CLI
│  │  ├─ src/
│  │  │  ├─ Bash.ts                       public Bash class + exec()
│  │  │  ├─ parser/                       lexer + recursive-descent parser
│  │  │  ├─ ast/                          AST node types
│  │  │  ├─ interpreter/                  AST walker, expansion, builtins
│  │  │  ├─ fs/
│  │  │  │  ├─ in-memory-fs/              pure VFS, no disk
│  │  │  │  ├─ overlay-fs/                COW over real dir, mem writes
│  │  │  │  ├─ read-write-fs/             passthrough to real dir
│  │  │  │  ├─ mountable-fs/              union of FS instances
│  │  │  │  ├─ real-fs-utils.ts           central path/symlink gate
│  │  │  │  └─ path-utils.ts              pure path helpers (browser-safe)
│  │  │  ├─ commands/                     ~79 command impls (one dir each)
│  │  │  │  ├─ awk/                       AWK parser+executor
│  │  │  │  ├─ sed/                       SED parser+executor
│  │  │  │  ├─ python3/                   CPython-WASM worker
│  │  │  │  ├─ sqlite3/                   sql.js worker
│  │  │  │  ├─ js-exec/                   QuickJS worker
│  │  │  │  ├─ curl/                      uses secureFetch
│  │  │  │  └─ registry.ts                lazy import registry
│  │  │  ├─ network/                      secureFetch + allow-list
│  │  │  ├─ security/                     defense-in-depth-box, blocked-globals
│  │  │  ├─ sandbox/                      @vercel/sandbox-compatible API
│  │  │  ├─ regex/                        re2js wrapper (linear regex)
│  │  │  ├─ cli/just-bash.ts              CLI entry point
│  │  │  ├─ limits.ts                     ExecutionLimits defaults
│  │  │  └─ transform/                    AST transform plugins
│  │  ├─ vendor/cpython-emscripten/       prebuilt CPython 3.13 WASM
│  │  └─ package.json
│  └─ just-bash-executor/                 tool-invocation glue (experimental)
└─ examples/                              bash-agent, cjs-consumer, website
```

Pipeline: `Input → Parser → AST → Interpreter → ExecResult` (CLAUDE.md:96-100).

---

## 3. Threat model (HIGH confidence — directly read THREAT_MODEL.md)

### 3.1 What just-bash defends against

The threat model defines three actor classes (THREAT_MODEL.md:9-28):

| Actor | Trust | What they control |
|---|---|---|
| Untrusted script author (AI agent) | ZERO | The bash script being executed |
| Malicious data source | ZERO | Bytes flowing through expansions, vars |
| Compromised dependency | N/A | Out of scope for runtime defenses |

Defended attack classes (THREAT_MODEL.md:92-219):

- **Parser DoS** — token bombs, deep nesting, oversized input, heredoc bombs.
  Caps at `MAX_TOKENS=100K`, `MAX_PARSER_DEPTH=200`, `MAX_INPUT_SIZE=1MB`
  (packages/just-bash/src/parser/types.ts:10-13).
- **Expansion DoS** — brace bombs (`{1..999999}`), nested cmd substitution,
  glob bombs, variable indirection chains, IFS injection, arithmetic
  overflow (THREAT_MODEL.md:104-117).
- **Filesystem escape** — path traversal (`../../etc/passwd`), symlink
  escape, null-byte injection, TOCTOU races, writes to host FS, /proc
  reads, broken-symlink writes, real-path disclosure in errors
  (THREAT_MODEL.md:121-130).
- **Network exfiltration** — disabled by default. When enabled: origin +
  path-prefix allow-list, per-redirect re-validation, response-size cap,
  scheme restriction, URL-confusion (`@`-prefix) rejection, header
  pollution via null-prototype objects (THREAT_MODEL.md:133-141,
  network/allow-list.ts:14-69).
- **Code-execution escape** — `Function`, `eval`, `setTimeout(string)`,
  `.constructor.constructor`, async/generator constructor chains,
  `process.binding`/`dlopen`, `Module._load`/`_resolveFilename`,
  `Error.prepareStackTrace`, `WebAssembly`, `Proxy`, `WeakRef`,
  `process.chdir`, dynamic `import()` via ESM loader hooks
  (THREAT_MODEL.md:144-162).
- **Information disclosure** — `process.env`/`argv`/`execPath`, host
  PID/UID/hostname, error messages, timing side channels
  (`hrtime`/`performance.now()`) (THREAT_MODEL.md:166-179).
- **DoS** — infinite loops (`maxLoopIterations=10K`), fork bombs
  (`maxCallDepth=100`), command flood (`maxCommandCount=10K`), memory
  exhaustion (`maxStringLength=10MB`, `maxArrayElements=100K`), ReDoS
  (re2js linear-time engine), `process.exit/abort/kill`, AWK/SED runaway
  loops, source-depth bombs, FD exhaustion, glob `**` depth
  (THREAT_MODEL.md:183-196, limits.ts:73-92).
- **Privilege escalation** — `setuid`/`setgid`/`umask` blocked;
  `chmod`/`chown` operate on the VFS only (THREAT_MODEL.md:200-205).
- **Prototype pollution** — env stored in `Map<string,string>`; all
  user-keyed records use `Object.create(null)` or `nullPrototype()` from
  `safe-object.ts`; `__defineGetter__/__defineSetter__` blocked; `JSON`
  and `Math` frozen (THREAT_MODEL.md:209-219, CLAUDE.md:216-251).

### 3.2 What just-bash explicitly does NOT defend against

Trust assumptions (THREAT_MODEL.md:31-37):

1. The Node.js binary, V8, and OS kernel are trusted.
2. Host-provided `fs`, `fetch`, `customCommands`, and AST transform plugins
   are **trusted**. A malicious host hook bypasses all sandboxing by design.
3. Supply-chain attacks via npm are out of scope; addressed by lockfiles.

Known residual risks (THREAT_MODEL.md:223-329):

- **`data:` URL `import()` on Node.js < 20.6** — `module.register()` is
  unavailable, so `import('data:text/javascript,...')` from any leaked
  `Function` reference is unblockable. Mitigated only by the architectural
  claim "no code path exists from bash to JS."
- **Pre-captured references** — anything that grabs `Function`/`eval`
  before the DiD box is activated bypasses the proxy.
- **Python (when enabled)** — full Python execution surface; isolation is
  "by construction" (no `import js`, no ctypes, no NODEFS), but it is
  still WASM running in a worker.
- **Signal/job control** — `trap`, `&`, `fg`, `bg` are not exhaustively
  tested for security.
- **Unicode/encoding edge cases** — no fuzzing for homographs, invalid
  UTF-8, RTL overrides. These are display/confusion attacks, not escape
  vectors.

### 3.3 Verdict table

THREAT_MODEL.md §6 (lines 351-376) enumerates 22 named scenarios. All but
the Python-enabled case and pre-Node-20.6 `data:` URL imports are marked
**BLOCKED**. For Cog's purposes, on Node 20.6+ with Python/JS-exec off, the
JS-escape surface is small.

---

## 4. Sandboxing primitives (HIGH confidence)

### 4.1 The four filesystems

`IFileSystem` is the interface (packages/just-bash/src/fs/interface.ts:1-60).
Four implementations, all in `src/fs/`:

| FS | Reads | Writes | Use case |
|---|---|---|---|
| `InMemoryFs` | RAM | RAM | hermetic, no disk |
| `OverlayFs` | real disk under `root` | RAM (COW) | "agent dry-run on real repo" |
| `ReadWriteFs` | real disk under `root` | real disk under `root` | "agent edits a workspace" |
| `MountableFs` | dispatches to mounted FS | dispatches | combine the above per-path |

Each instance pins a `root` directory. `OverlayFs` and `ReadWriteFs` both
default to `allowSymlinks: false` (CLAUDE.md:199-214,
overlay-fs/overlay-fs.ts:106-110).

### 4.2 Root-confinement strategy

The central trick: there are exactly two gate functions, and every real-FS
op routes through them.

- `resolveCanonicalPath(realPath, canonicalRoot)` — calls `fs.realpathSync`,
  walks up on `ENOENT` to find the nearest existing parent, then verifies
  the canonical result is still inside `canonicalRoot`. Crucially it
  *returns* the canonical path so callers can use it for the actual I/O,
  closing the TOCTOU gap (real-fs-utils.ts:71-116).
- `resolveCanonicalPathNoSymlinks(realPath, root, canonicalRoot)` — adds a
  "did any symlink get traversed?" check by comparing
  `resolvedReal.slice(root.length)` vs `canonical.slice(canonicalRoot.length)`.
  Mismatch ⇒ symlink in the path ⇒ reject. Zero extra I/O cost
  (real-fs-utils.ts:130-164, CLAUDE.md:206-208).

`OverlayFs.resolveRealPath_()` dispatches to one or the other based on
`allowSymlinks` (overlay-fs/overlay-fs.ts:297-307). Every method that
touches the real FS goes through this gate or its parent-only sibling
`resolveRealPathParent_` (overlay-fs/overlay-fs.ts:315-321).

`isPathWithinRoot` itself is a boundary-safe prefix check that appends a
slash so `/data` does not match `/datastore` (real-fs-utils.ts:24-31).

`validateRootDirectory` enforces that the configured root exists and is a
directory at construction time and intentionally omits the real path from
its error message to avoid info leakage (real-fs-utils.ts:172-180).

### 4.3 Default-deny symlinks — how it's enforced

CLAUDE.md:199-214 is the canonical statement. In code:

- `OverlayFs.symlink()` and `ReadWriteFs.symlink()` throw `EPERM` when
  `allowSymlinks=false`.
- Any path that *traverses* a symlink anywhere in its components is
  rejected via the `resolveCanonicalPathNoSymlinks` mismatch check above.
- A defense-in-depth `lstatSync` at the leaf component catches the
  "broken-symlink-pointing-outside-sandbox" case: `realpathSync` returns
  `ENOENT` because the target is missing, the walk-up appends the literal
  basename and the relative paths look identical — without this extra
  check, a `writeFile` would create the target file outside the sandbox
  (real-fs-utils.ts:146-162).
- `lstat()` and `readlink()` still work (they inspect, don't follow).
- `readdir()` lists symlink entries; operations through them fail.

### 4.4 TOCTOU protections

Three concrete techniques (CLAUDE.md:210-212):

1. `resolveCanonicalPath` **returns** the canonical path so the caller
   never re-resolves an attacker-controlled relative path.
2. `ReadWriteFs.readFile/writeFile/appendFile` use `O_NOFOLLOW` via
   `fs.promises.open()` when `allowSymlinks=false`, so a symlink-swap
   between validation and `open` cannot win.
3. `writeFile`/`appendFile` re-validate paths after `mkdir()` to catch
   parent-directory-swap attacks.

### 4.5 Error sanitization

`sanitizeFsError` (real-fs-utils.ts:238-254) collapses every
`ErrnoException` into a `"<code>: <operation> '<virtualPath>'"` message,
hiding the real OS path. `sanitizeErrorMessage` (re-exported from
sanitize-error.ts) strips `node:internal/...` and absolute paths from
stack traces at all the major choke points: builtin dispatch, `Bash.exec()`
including `SecurityViolationError`/`ExecutionLimitError`, the CLI, and the
Python FS bridge (THREAT_MODEL.md:313-316).

### 4.6 The defense-in-depth box

A secondary layer (THREAT_MODEL.md:332-347,
security/defense-in-depth-box.ts:1-30). Mechanism:

- `AsyncLocalStorage` tracks "are we inside `bash.exec()`?" — blocks only
  fire in that context, so concurrent host code in the same process keeps
  working.
- Reference-counted for nested `exec()` calls.
- Two strategies (security/blocked-globals.ts:21-22): `"throw"` replaces
  the global with a proxy that throws on access/call; `"freeze"` calls
  `Object.freeze` (used for `JSON`/`Math`/`Reflect`).
- `allowedKeys` per-global lets specific reads through where Node
  internals need them during module loading.

Blocked globals (security/blocked-globals.ts:73 onward, sampled):
`Function`, `eval`, `setTimeout`, `setInterval`, `setImmediate`,
`process.env`, `process.binding`, `process._linkedBinding`,
`process.dlopen`, `process.getBuiltinModule`, `process.exit`,
`process.abort`, `process.kill`, `process.setuid/setgid/seteuid/setegid`,
`process.initgroups/setgroups`, `process.umask`, `process.argv`,
`process.cwd`, `process.chdir`, `process.report`, `process.loadEnvFile`,
`process.setUncaughtExceptionCaptureCallback`, `process.send`,
`process.channel`, `process.cpuUsage`, `process.memoryUsage`,
`process.hrtime`, `WeakRef`, `FinalizationRegistry`, `Reflect` (frozen),
`Proxy`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `performance`,
`process.stdout`, `process.stderr`, plus `Error.prepareStackTrace`,
`process.mainModule`, and `process.execPath` blocked via `defineProperty`
(THREAT_MODEL.md:146-179).

The box is honest about itself: "This is a SECONDARY defense layer. It
should never be relied upon as the primary security mechanism."
(defense-in-depth-box.ts:9-11).

---

## 5. WASM-free execution: how bash gets interpreted in pure TS (HIGH confidence)

### 5.1 The pipeline

`Input → Parser (src/parser/) → AST (src/ast/) → Interpreter
(src/interpreter/) → ExecResult` (CLAUDE.md:96-100, parser/parser.ts:1-15).

### 5.2 Parser

- **Lexer** (`src/parser/lexer.ts`) — bash-specific tokenization with
  heredocs, quoting, expansions. Pre-computed `Set<TokenType>` tables for
  redirection lookups so the hot path doesn't allocate arrays
  (parser/types.ts:16-58).
- **Recursive-descent parser** (`src/parser/parser.ts`) producing AST nodes
  by delegating to specialized sub-parsers: `arithmetic-parser.ts` (`$((...))`
  and `((...))`), `compound-parser.ts` (if/for/while/case/function),
  `conditional-parser.ts` (`[[ ]]` and `[ ]`), `expansion-parser.ts`
  (parameter expansion, command substitution), `word-parser.ts`,
  `parser-substitution.ts`, `command-parser.ts` (parser/parser.ts:33-44).
- Grammar sketch documented inline in parser.ts:7-14.

### 5.3 Parser hard limits

All centralized in `parser/types.ts:10-13`:

```
MAX_INPUT_SIZE       = 1_000_000     // 1MB max input
MAX_TOKENS           = 100_000       // max tokens to parse
MAX_PARSE_ITERATIONS = 1_000_000     // max iterations in parsing loops
MAX_PARSER_DEPTH     = 200           // max recursion depth
```

### 5.4 Interpreter

`src/interpreter/interpreter.ts` is the AST walker. Specialized modules:

- `expansion.ts` / `expansion/parameter-ops.ts` — parameter, brace, glob,
  tilde, command substitution
- `arithmetic.ts` — `$((...))` with values clamped to `MAX_SAFE_INTEGER`
  (no 64-bit; intentional, CLAUDE.md:262)
- `conditionals.ts` — `[[ ]]` and `[ ]`
- `control-flow.ts` — loops and conditionals
- `pipeline-execution.ts` — `|` pipelines
- `redirections.ts` — `>`, `>>`, `2>&1`, here-docs, etc.
- `subshell-group.ts` — `( ... )` and `{ ... }`
- `builtins/` — `export`, `local`, `declare`, `read`, `source`, `set`, etc.
- `builtin-dispatch.ts` — single chokepoint that catches errors and
  sanitizes them.

There is no `child_process`, no `vm` module, no shelling out anywhere in
the code path (THREAT_MODEL.md:162: "Not imported anywhere; no code path
from interpreter").

### 5.5 Runaway-compute limits

`src/limits.ts:73-92` — every default in one place:

```
maxCallDepth              = 100        // function recursion
maxCommandCount           = 10000      // total commands per exec
maxLoopIterations         = 10000      // bash for/while/until
maxAwkIterations          = 10000
maxSedIterations          = 10000
maxJqIterations           = 10000
maxSqliteTimeoutMs        = 5000
maxPythonTimeoutMs        = 10000      // 60000 with network
maxJsTimeoutMs            = 10000      // 60000 with network
maxGlobOperations         = 100000
maxStringLength           = 10485760   // 10MB
maxArrayElements          = 100000
maxHeredocSize            = 10485760   // 10MB
maxSubstitutionDepth      = 50         // $($($(...)))
maxBraceExpansionResults  = 10000      // {1..N}
maxOutputSize             = 10485760   // 10MB combined stdout+stderr
maxFileDescriptors        = 1024
maxSourceDepth            = 100
```

All are overridable per-instance via `executionLimits` on `BashOptions`
(packages/just-bash/README.md:560-574). Hard caps are also baked into
specific paths (e.g. `MAX_GLOBSTAR_SEGMENTS=5` for `**/**/...` patterns in
`shell/glob.ts`, mid-loop `maxStringLength` checks in
`interpreter/expansion/parameter-ops.ts`).

### 5.6 Linear-time regex via re2js

User regexes are not handed to the V8 `RegExp` engine. They go through
`src/regex/user-regex.ts` which uses the `re2js` package — Google RE2's
linear-time engine ported to JS, so catastrophic backtracking (ReDoS) is
not possible (THREAT_MODEL.md:189).

---

## 6. Command coverage (HIGH confidence)

The supported list is enumerated as a TypeScript union type
`CommandName` in `packages/just-bash/src/commands/registry.ts:15-98` (~79
commands). Each command lazy-loads via `commandLoaders[]`
(registry.ts:117-219), so the bundler keeps them out of the hot path.

### 6.1 Supported (always on)

| Category | Commands |
|---|---|
| File ops | `cat`, `cp`, `file`, `ln`, `ls`, `mkdir`, `mv`, `readlink`, `rm`, `rmdir`, `split`, `stat`, `touch`, `tree` |
| Text proc | `awk`, `base64`, `column`, `comm`, `cut`, `diff`, `expand`, `fold`, `grep` / `egrep` / `fgrep`, `head`, `join`, `md5sum`, `nl`, `od`, `paste`, `printf`, `rev`, `rg`, `sed`, `sha1sum`, `sha256sum`, `sort`, `strings`, `tac`, `tail`, `tr`, `unexpand`, `uniq`, `wc`, `xargs` |
| Data | `jq` (JSON), `sqlite3` (SQLite via sql.js WASM, worker), `xan` (CSV), `yq` (YAML/XML/TOML/CSV via `yaml` + `fast-xml-parser` + `smol-toml`) |
| Compression | `gzip`/`gunzip`/`zcat`, `tar` (via `modern-tar`; optional `zstd`, `lzma`, `bzip2`) |
| Nav/env | `basename`, `cd`, `dirname`, `du`, `echo`, `env`, `export`, `find`, `hostname`, `printenv`, `pwd`, `tee` |
| Shell utils | `alias`, `bash`, `chmod`, `clear`, `date`, `expr`, `false`, `help`, `history`, `seq`, `sh`, `sleep`, `time`, `timeout`, `true`, `unalias`, `which`, `whoami` |

`grep` and `sed` are full implementations: `grep` supports `-E`/`-P`/`-F`,
context (`-A`/`-B`/`-C`), recursion, include/exclude globs, etc.
(commands/grep/grep.ts:14-44). `sed` has its own lexer, parser, and
executor with pattern/hold-space semantics and branch limits
(commands/sed/, CLAUDE.md:140-145). `awk` likewise has a parser+executor
with BEGIN/END, user-defined functions (caveat: single-expression bodies
only — CLAUDE.md:137-138).

### 6.2 Opt-in capability surfaces

| Capability | Flag | Mechanism | Default |
|---|---|---|---|
| Network | `network: {...}` | secureFetch + URL allow-list | OFF |
| Python | `python: true` | CPython 3.13 Emscripten WASM in worker | OFF |
| JS/TS | `javascript: true` | QuickJS Emscripten WASM in worker | OFF |

`curl` is *only registered* when `network` is configured
(THREAT_MODEL.md:135). Without it, `curl` returns "command not found".
`python3`/`python` only exist when `python: true`. `js-exec` only exists
when `javascript: true`.

### 6.3 Bash features

From README:560-574 and AST coverage: pipes, all the standard
redirections, `&&`/`||`/`;`, parameter and brace and tilde and glob
expansion, positional params, if/elif/else, for/while/until, C-style for,
case, functions (`name(){...}` and `function name {...}`), `local`,
symbolic and hard links (operate on VFS), trap (partial), `set -e`,
arrays and associative arrays, here-docs and here-strings.

### 6.4 What's NOT supported

- **Real binary execution** — no `gcc`, no `node` (unless via `js-exec`),
  no `python` (unless via `python3` WASM), no `git`, no `npm`/`pnpm`/`yarn`.
- **Process/job control with real PIDs** — `&`, `fg`, `bg`, `kill`,
  `jobs`, `wait` are virtualized at best and not security-tested
  (THREAT_MODEL.md:260-265).
- **64-bit integers** — clamped to `MAX_SAFE_INTEGER` (CLAUDE.md:262).
- **`/proc`, `/sys`, `/dev/fd/`** — not exposed
  (THREAT_MODEL.md:127, 275-277).
- **Real signals/traps to OS** — `trap` is partial.
- **Loadable bash builtins, `bash -O`** — not modeled.
- **Real `chmod`/`chown` on host** — only on VFS.

### 6.5 Fallback strategy for a coding agent

The natural pattern: classify each tool call.

- Inside `just-bash` for: reading files, grepping, jq/sed/awk-style data
  munging, running scripts that combine the above, optional Python/JS
  scratch work, allow-listed HTTP.
- Outside `just-bash` for: anything requiring a real process — running
  the project's tests, installing deps, invoking compilers/linters, git
  ops. For those, either (a) shell out from the agent's *trusted host*
  code with whatever sandbox you already have (bwrap, Docker, macOS
  `sandbox-exec`), or (b) treat them as separate tool definitions
  outside the bash tool.

---

## 7. CLI entry point (HIGH confidence)

CLI binary: `dist/bin/just-bash.js`, source at
`packages/just-bash/src/cli/just-bash.ts`. Installed by `npm install -g
just-bash` (package.json:52-54).

### 7.1 Invocation shapes (cli/just-bash.ts:7-37, 60-108)

```
just-bash -c '<script>'                          # inline
just-bash <script.sh>                            # file (read via OverlayFS)
echo '<script>' | just-bash                      # stdin
just-bash [options] [positional script-or-root]
```

### 7.2 Flags

| Flag | Meaning | Default |
|---|---|---|
| `-c <script>` | inline script | — |
| `--root <path>` | OverlayFS root | `process.cwd()` |
| `--cwd <path>` | working dir inside sandbox | mount point `/home/user/project` |
| `--allow-write` | enable writes (still memory-only via OverlayFS) | off |
| `--python` | enable `python3`/`python` | off |
| `--javascript` | enable `js-exec` | off |
| `--json` | emit `{stdout,stderr,exitCode}` JSON | off |
| `-e`, `--errexit` | prepend `set -e` | off |
| `-h`, `-v` | help/version | — |

(cli/just-bash.ts:115-219.)

### 7.3 Behavior

- The CLI always uses `OverlayFs` (cli/just-bash.ts:306-309). Writes stay
  in RAM and are discarded when the process exits, even with
  `--allow-write`. This is intentional: the CLI is designed to be a
  "safe bash for agents," not a real shell.
- Project root is mounted at `/home/user/project` inside the VFS. The
  agent must reference files via that path or rely on `cwd` defaulting
  there (README:535).
- Errors are routed through `sanitizeErrorMessage` so OS paths and
  internal Node stack frames are stripped (cli/just-bash.ts:350-365).
- Network is **off** when using the CLI (no `--network` flag), and
  `curl` reports "command not found" (cli/just-bash.ts:316-321, no
  network option wired in).
- There is also `pnpm shell` / `just-bash-shell` for an interactive
  REPL — it defaults to full network on, opposite of the one-shot CLI
  (README:546-555).

### 7.4 How an agent shells out to it

The pragmatic envelope from a Cog-style host:

```ts
import { spawn } from "node:child_process";

const child = spawn(
  "just-bash",
  ["-c", agentScript, "--root", workspaceDir, "--json"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
// optional: pipe a JSON tool result into stdin
// collect stdout (it's the JSON envelope), enforce a wall-clock timeout
```

The `--json` mode gives you a single line of `{stdout,stderr,exitCode}`
that's trivial to parse. There's no streaming protocol; output is
buffered up to `maxOutputSize` (10MB default).

For the "in-process" path you can skip the CLI entirely and use the
library: `new Bash({fs: new OverlayFs({root}), ...}).exec(script)`
(README:165-187). This is what bash-tool / @just-bash/executor do.

---

## 8. Python and SQLite — embedding untrusted runtimes (MEDIUM confidence — read summaries, not the workers)

### 8.1 Python (CPython 3.13 Emscripten)

Implemented at `src/commands/python3/`. Key points from CLAUDE.md:147-159
and THREAT_MODEL.md:279-310:

- WASM binary ships in `vendor/cpython-emscripten/python.cjs`.
- Each `python3` invocation spawns a **fresh worker thread**
  (`EXIT_RUNTIME`); no state leaks between runs.
- 30-second timeout (`maxPythonTimeoutMs`, configurable); worker is
  *terminated* on timeout via a `workerRef` pattern, not just signaled.
- WASM memory capped at 512MB (`-sMAXIMUM_MEMORY=536870912`).
- The big idea: **isolation by construction**, not policy. The CPython
  binary is compiled without the escape vectors:
  - No `-sMAIN_MODULE` ⇒ `dlopen` raises "dynamic linking not enabled".
  - No `nodefs.js`/`idbfs.js`/`proxyfs.js`/`workerfs.js` ⇒ no way to mount
    host FS.
  - No `_ctypes` C extension ⇒ `import ctypes` fails.
  - No `_emscripten_run_script` ⇒ no JS eval from WASM.
  - `__emscripten_system` patched to return -1.
  - Stdlib shipped as `.pyc`-only zip in MEMFS — no source, no runtime
    compilation of arbitrary code into the FS.
  - `import js` raises `ModuleNotFoundError` — the module simply doesn't
    exist in the binary (no JS bridge).
- File operations are redirected through a `/host` mount that goes
  through the same VFS gates as bash (`fs-bridge-handler.ts` on the main
  thread, `sync-fs-backend.ts` + `SharedArrayBuffer` protocol from the
  worker).
- HTTP from Python goes via a custom HTTPFS mount at `/_jb_http` that
  reuses `secureFetch` and the same URL allow-list.
- Raw TCP/UDP blocked by Emscripten ("Host is unreachable").
- `-m MODULE` arg validated against `/^[a-zA-Z_][a-zA-Z0-9_.]*$/` to
  prevent injection (CLAUDE.md:155).
- Defense-in-depth: `Module._load` blocked at file scope *before* WASM
  loads, then `WorkerDefenseInDepth` after (with only
  `shared_array_buffer` and `atomics` allowed because the SAB FS protocol
  needs them).

Accepted residual risks: Python's own `eval`/`exec` are allowed (same as
bash `eval`); no JS escalation path exists.

### 8.2 SQLite (sql.js)

`sqlite3` uses sql.js — SQLite compiled to WASM. From README:411-425 and
package.json:120 (`sql.js: ^1.13.0`):

- Sandboxed from the real filesystem; databases live in the VFS.
- Queries run in a **worker thread** with a 5s default timeout
  (`maxSqliteTimeoutMs`).
- WASM is approved as a sql.js exception in the otherwise no-WASM rule
  (CLAUDE.md:260: "Dependencies using WASM are not allowed (exception:
  sql.js for SQLite, approved for security sandboxing)").

### 8.3 js-exec (QuickJS)

Optional. README:311-360: QuickJS in WASM, 64MB memory cap, 10s default
timeout (60s with network). Worker thread per invocation. Provides a
controlled Node-like environment with a curated subset of `fs`, `path`,
`child_process` (which routes back through `just-bash`!), `process`,
`os`, etc., plus a `tools` proxy if a host `invokeTool` callback is
configured.

### 8.4 Lessons for embedding untrusted runtimes

What just-bash does that's worth copying for any Cog-side runtime:

1. **Strip capabilities at build time, not just at runtime.** Removing
   `_ctypes`/NODEFS/`-sMAIN_MODULE` is unforgeable; runtime monkey-patches
   are not.
2. **One worker per invocation.** Termination on timeout is reliable;
   "cooperative cancellation in the same thread" is not.
3. **Route the runtime's FS calls through the same gate as the shell.**
   Don't let Python see `os.open` differently from bash `cat`.
4. **Reuse the network allow-list.** Python's `urllib.request` should be
   subject to the same `secureFetch` allow-list as `curl`.
5. **Validate dynamic args even when the runtime is "trusted."** The
   `-m` module-name regex is the type of small thing that prevents a
   surprising injection.

---

## 9. Dependency footprint (HIGH confidence)

From `packages/just-bash/package.json:107-128`:

### Required runtime deps (14)

```
diff               text diffing
fast-xml-parser    xml support for yq
file-type          binary sniffing for `file` command
ini                ini support for yq
minimatch          glob matching
modern-tar         tar
papaparse          csv for xan
quickjs-emscripten js-exec
re2js              linear-time regex (no ReDoS)
seek-bzip          bzip2
smol-toml          toml for yq
sprintf-js         printf
sql.js             sqlite3
turndown           html-to-markdown
yaml               yaml for yq
```

### Optional deps (2)

```
@mongodb-js/zstd   zstd
node-liblzma       xz/lzma
```

### Things that are notably absent

- No `vm`-based eval lib.
- No `node-pty`, no `dockerode`, no `firecracker-node`.
- No `bash` binary, no `child_process` wrapper.
- Vendored CPython is shipped as bytes under `vendor/cpython-emscripten/`,
  not as an npm dep.

### Footprint for a minimal agent

For Cog, "minimal" depends on which features you keep. If you ship:

- **Core bash + VFS + std cmds only** (no python, no sqlite, no js-exec):
  you can mark the WASM-y deps external (`quickjs-emscripten`, `sql.js`)
  and they won't be loaded. The build script already does this for the
  CLI bundle (package.json:66, `--external:sql.js
  --external:quickjs-emscripten`).
- **+ network**: zero extra deps; `secureFetch` uses Node's built-in
  `fetch`.
- **+ sqlite or js-exec**: drag in their WASM blobs (~MBs each).
- **+ python**: drag in the vendored 20+MB CPython blob.

For embedding as a library you'd be looking at roughly 14 small-to-medium
npm deps + ~5-30MB of optional WASM artifacts. That's heavy compared to
"nothing" but lighter than "ship a container."

---

## 10. Alternatives and where just-bash fits (MEDIUM confidence)

The general landscape, ordered by isolation strength:

| Approach | Isolation | Setup cost | Runs real binaries? | Notes |
|---|---|---|---|---|
| `eval` / raw `child_process.spawn('bash', ...)` | none | trivial | yes | obviously unsafe for untrusted scripts |
| **just-bash (this thing)** | **language-level + VFS, in-process** | **`npm i`** | **no** | **defends scripts, not hosts; no real procs** |
| macOS `sandbox-exec` | kernel MAC profile | small | yes | macOS only; profiles are gnarly; deprecated |
| Linux `bwrap` (Bubblewrap) | user namespaces + seccomp | small | yes | Linux only; tight FS confinement, hard CPU/mem caps via cgroups separately |
| Linux seccomp + namespaces hand-rolled | what bwrap wraps | high | yes | only do this if you have a reason |
| Docker / Podman | full container | medium | yes | shared kernel; well-trodden; heavyweight per call |
| gVisor (`runsc`) | user-space kernel intercepting syscalls | medium | yes | great isolation, perf cost, Linux only |
| Firecracker microVMs | full KVM microVM | medium-high | yes | strong isolation, ~125ms boot, Linux only |
| Vercel Sandbox / Codesandbox / E2B / Modal | managed microVM SaaS | tiny in code, $$ in ops | yes | someone else's microVM; network round-trip |

### Where just-bash specifically fits

- **In-process** — no extra processes, no IPC. Latency is dominated by
  parsing and JS overhead.
- **Cross-platform** — the core works on macOS, Linux, Windows, even
  in the browser (minus FS-backed FS, Python, SQLite, js-exec —
  README:584-586).
- **Stateful between calls in one process** — VFS persists across
  `exec()` calls; env/cwd reset per call (README:25).
- **Defends scripts, not hosts** — see §3.2. A compromised host can
  trivially escape; a compromised script can't (modulo the residual
  risks).
- **No real binaries** — this is the load-bearing limitation. If your
  agent needs to run `pytest`, `tsc`, `cargo build`, or `git pull`,
  just-bash alone is not enough.

### Decision rubric

You probably want **just-bash** if all of these are true:

- Your agent's bash usage is mostly file inspection, text munging, jq,
  searching, and small scripts.
- You don't need to run user binaries or package managers.
- You're already on Node/TS and don't want to manage containers per call.
- You want one consistent sandbox on all dev machines (incl. macOS)
  without a kernel-specific setup.
- "Pretty safe in-process; never trust the host" is an acceptable
  trust statement.

You probably want **bwrap / Firecracker / Vercel Sandbox** if any of:

- The agent needs to run arbitrary binaries (`tsc`, `pytest`, `cargo`,
  `gcc`, `git`, your project's CI).
- You need real OS-level resource limits beyond per-`exec()` JS counters.
- You need to share the sandbox with non-bash tools (LSPs, debuggers).
- You're untrustingly hosting *other people's* code (multi-tenant SaaS)
  rather than your own agent.

You may want **both** — a common pattern is: just-bash for "safe
read-only inspection and text processing" (default, low overhead) and a
real sandbox for "now actually run the test suite" (gated, expensive).

---

## 11. Recommendation for Cog (LOW–MEDIUM confidence; based on read-only investigation)

**Recommendation: embed `just-bash` as an npm dependency for the
"inspect-and-munge" bash tool; build a separate, narrower tool that runs
real binaries inside `bwrap` / macOS `sandbox-exec` / a Vercel Sandbox
microVM. Do not fork.**

Why not fork:

- Active, well-tested, well-documented (the threat model alone is
  unusual). Forking inherits a maintenance burden that you almost
  certainly don't want for an agent side-project.
- The library surface is clean: `new Bash({ fs, executionLimits, network,
  customCommands, customCommands }).exec(script)` is everything you need
  (Bash.ts:114-).
- `defineCommand` lets you add Cog-specific commands without modifying
  the library (README:28-54).
- AST transform plugins (`registerTransformPlugin`) give you a hook for
  instrumentation / per-command logging without forking
  (README:427-449).

Why not roll your own:

- Reproducing the gate-based symlink/TOCTOU model from
  `real-fs-utils.ts` correctly is a 1-2 week project on its own. The
  broken-symlink-leaf check in `resolveCanonicalPathNoSymlinks` is the
  kind of bug you only find by reading the threat model.
- The 18 default execution limits in `limits.ts` are tuned values; you'd
  re-derive them from your own production bugs over months.
- re2js + null-prototype-everywhere + AsyncLocalStorage-scoped global
  blocking are each individually small but they're tedious and
  load-bearing.

What to verify before depending:

1. **Re-confirm Node.js floor.** The `data:` URL `import()` mitigation
   requires Node 20.6+ (THREAT_MODEL.md:239). Make Cog require ≥ 20.6
   if you depend on just-bash.
2. **Decide on opt-in surfaces.** I'd start with `python: false,
   javascript: false, network: undefined`. Add `network` as a narrow
   allow-list once you have a clear product story; treat
   `python`/`javascript` as a "later" decision because they each
   meaningfully widen the attack surface (Python especially per
   THREAT_MODEL.md:281).
3. **Lock the host trust boundary.** Anything you pass into the `Bash`
   constructor (custom commands, custom `fs`, custom `secureFetch`,
   `invokeTool` callbacks) bypasses sandboxing by design. Treat them as
   trusted Cog code, code-review them, and never feed user input into
   their construction.
4. **Map "run real binaries" to a separate tool.** Don't try to bend
   just-bash into running `pytest`. Either:
   - shell out from Cog's trusted layer to `bwrap` / `sandbox-exec`,
   - or punt to a managed microVM (Vercel Sandbox, E2B, etc.), which
     has the bonus of giving you a `Sandbox`-compatible API already
     implemented by just-bash (README:478-507) so you can swap them.
5. **Watch the beta label.** Package README:7 explicitly says "This is
   beta software." Pin to an exact version, write integration tests
   that exercise your usage, and re-read the changelog on upgrades.

What I'd build on top:

- A thin Cog wrapper around `Bash` that:
  - Configures `OverlayFs({root: workspaceDir})` so the agent can read
    the real project but can't mutate it.
  - Wires Cog logging into `BashLogger`.
  - Registers a `defineCommand` set for Cog-specific tools.
  - Optionally registers a `CommandCollectorPlugin` transform for
    per-command audit logging.
- A separate `runReal(binary, args, {timeout, cwd})` tool that does the
  containerized thing, completely outside just-bash.

---

## 12. Open questions

- **Throughput for large repos.** README and threat model talk about
  per-script limits, not how `OverlayFs` performs when reading a giant
  monorepo. Worth a benchmark before committing.
- **Memory ceiling per exec().** The threat model explicitly lists
  "total memory ceiling" as a hardening recommendation that is *not*
  implemented (THREAT_MODEL.md:384, item 5). The current limits are
  per-object, not aggregate. Long-running agents with many `exec()`
  calls in one process should monitor.
- **AST transform plugin ergonomics.** I didn't read
  `src/transform/README.md`; if you plan to instrument heavily, read
  that next.
- **just-bash-executor maturity.** Marked `experimental` (executor
  README:8-11); not a blocker but don't depend on it without reading
  its source.
- **CLI vs library latency.** Spawning the CLI per `exec()` adds Node
  startup cost (~50-200ms). For a high-throughput agent loop the
  library is the right answer; the CLI is more of a "call it from a
  non-Node host" affordance.
- **Per-`exec()` AsyncLocalStorage interactions.** If Cog's host code
  uses `AsyncLocalStorage` for tracing / request context, verify it
  composes cleanly with just-bash's DiD box.

---

## 13. Sources / file index

Key files cited, all under `/Users/connorlittleton/oss/just-bash/`:

- `README.md` — monorepo overview
- `CLAUDE.md` — internal architecture + invariants (read this first)
- `THREAT_MODEL.md` — exhaustive threat-model document, 38KB
- `packages/just-bash/README.md` — user-facing library README
- `packages/just-bash/package.json` — deps, scripts, build pipeline
- `packages/just-bash/src/Bash.ts` — public `Bash` class
- `packages/just-bash/src/cli/just-bash.ts` — CLI entry point
- `packages/just-bash/src/limits.ts` — all execution limits + defaults
- `packages/just-bash/src/parser/parser.ts`, `types.ts` — parser +
  limits
- `packages/just-bash/src/interpreter/interpreter.ts` — AST walker
- `packages/just-bash/src/fs/interface.ts` — `IFileSystem` contract
- `packages/just-bash/src/fs/real-fs-utils.ts` — central path/symlink
  gate
- `packages/just-bash/src/fs/overlay-fs/overlay-fs.ts` — OverlayFs
- `packages/just-bash/src/fs/read-write-fs/read-write-fs.ts` —
  ReadWriteFs
- `packages/just-bash/src/security/defense-in-depth-box.ts` — DiD box
- `packages/just-bash/src/security/blocked-globals.ts` — blocked-globals
  list
- `packages/just-bash/src/commands/registry.ts` — command registry +
  lazy loaders
- `packages/just-bash/src/commands/grep/grep.ts`,
  `commands/sed/sed.ts` — sampled command implementations
- `packages/just-bash/src/network/allow-list.ts`,
  `network/fetch.ts` — secureFetch + allow-list
- `packages/just-bash-executor/README.md` — experimental tool-invocation
  glue
