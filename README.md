# tap Language Support

VS Code extension for the tap programming language.

## Features

- Syntax highlighting for `.tp` and `.tap` files
- Line and block comments, bracket matching, auto-closing pairs, indentation, and folding markers
- Snippets for functions, imports, variables, conditions, loops, and print calls
- Commands for compiling and running the active file, emitting LLVM IR, lexing, and parsing
- Compiler diagnostics in the VS Code Problems panel for common `file:line:column: error: message` output
- Go to definition, find references, file outline, and workspace symbol search
- A `$tap` problem matcher for VS Code tasks

## Commands

- `tap: Compile File`
- `tap: Run File`
- `tap: Emit LLVM IR`
- `tap: Lex File`
- `tap: Parse File`

Set `tap.executablePath` if the compiler is not available as `tap` on your `PATH`.
All command argument lists are configurable. The source file path is appended
automatically.

```json
{
    "tap.executablePath": "tap",
    "tap.compilerArgs": [],
    "tap.workingDirectory": "",
    "tap.environment": {},
    "tap.compileArgs": [],
    "tap.runArgs": ["run"],
    "tap.emitIRArgs": ["-ir"],
    "tap.lexArgs": ["-lex"],
    "tap.parseArgs": ["-parse"],
    "tap.enableDiagnostics": true,
    "tap.clearDiagnosticsOnRun": true,
    "tap.enableNavigation": true,
    "tap.indexExclude": "**/build/**"
}
```

## Navigation

The extension indexes `fn` and `let` declarations in every `.tp` and `.tap` file
in the workspace, which powers:

- `F12` or `Ctrl+click` — go to definition
- `Shift+F12` — find all references
- `Ctrl+Shift+O` — file outline and breadcrumbs
- `Ctrl+T` — workspace symbol search

Comments and string literals are skipped, so declarations inside them are not
indexed. Builtin names such as `print` have no definition; jumping on one shows
a status bar hint instead. Set `tap.enableNavigation` to `false` to turn all of
this off, and `tap.indexExclude` to change which files are indexed.

If your compiler emits diagnostics in one of these common formats, they are
shown in the Problems panel:

```text
path/to/file.tp:3:12: error: expected expression
path/to/file.tp(3,12): warning: unused value
line 3, column 12: error: expected expression
error: standard library prelude.tp not found
```

## Build and Run

This extension is a plain JavaScript VS Code extension. It does not need a
TypeScript compile step before running.

### Prerequisites

- VS Code 1.46.0 or newer
- Node.js and npm
- The tap compiler, available as `tap` on `PATH` or configured with
  `tap.executablePath`

### Debug in VS Code

1. Open this folder in VS Code.
2. Press `F5`, or run `Run and Debug: Start Debugging`.
3. A new Extension Development Host window opens.
4. Open a `.tp` or `.tap` file in that window to test highlighting, snippets,
   commands, and diagnostics.

The included `.vscode/launch.json` already points VS Code at this extension
folder.

### Package a VSIX

Install the VS Code extension packaging tool if you do not already have it:

```bash
npm install -g @vscode/vsce
```

Then package the extension from this repository root:

```bash
vsce package
```

This creates a file like:

```text
tap-vscode-plugin-0.1.1.vsix
```

### Install the Packaged Extension

Install the generated VSIX from the command line:

```bash
code --install-extension tap-vscode-plugin-0.1.1.vsix
```

You can also install it from VS Code with `Extensions: Install from VSIX...`.

### Configure the Compiler Path

If `tap` is not on `PATH`, add this to your VS Code settings:

```json
{
    "tap.executablePath": "C:\\projects\\tap\\build\\tap.exe"
}
```

If the compiler needs an explicit standard library path, set it through the
extension environment:

```json
{
    "tap.environment": {
        "TAP_STD_PATH": "/path/to/tap/std",
        "TAP_RUNTIME_PATH": "/path/to/tap/build"
    }
}
```

`tap.workingDirectory` and environment values support `${workspaceFolder}`,
`${file}`, `${fileDirname}`, and `${cwd}`.

### Use the Problem Matcher in Tasks

You can also use the bundled `$tap` problem matcher from `.vscode/tasks.json`:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "tap: compile current file",
            "type": "shell",
            "command": "tap",
            "args": ["${file}"],
            "problemMatcher": "$tap",
            "group": "build"
        }
    ]
}
```

## Example

```tap
import std.math;

fn main(): i32 {
    let value: i32 = math.square(5);
    print("%d\n", value);
    return 0;
}
```
