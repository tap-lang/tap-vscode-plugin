# 4yue Language Support

VS Code extension for the 4yue programming language.

## Features

- Syntax highlighting for `.tp` and `.4yue` files
- Line and block comments, bracket matching, auto-closing pairs, indentation, and folding markers
- Snippets for functions, imports, variables, conditions, loops, and print calls
- Commands for running the active file, emitting LLVM IR, lexing, and parsing

## Commands

- `4yue: Run File`
- `4yue: Emit LLVM IR`
- `4yue: Lex File`
- `4yue: Parse File`

Set `4yue.executablePath` if the compiler is not available as `4yue` on your `PATH`.

## Build and Run

This extension is a plain JavaScript VS Code extension. It does not need a
TypeScript compile step before running.

### Prerequisites

- VS Code 1.46.0 or newer
- Node.js and npm
- The 4yue compiler, available as `4yue` on `PATH` or configured with
  `4yue.executablePath`

### Debug in VS Code

1. Open this folder in VS Code.
2. Press `F5`, or run `Run and Debug: Start Debugging`.
3. A new Extension Development Host window opens.
4. Open a `.tp` or `.4yue` file in that window to test highlighting, snippets,
   and commands.

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
4yue-vscode-plugin-0.0.1.vsix
```

### Install the Packaged Extension

Install the generated VSIX from the command line:

```bash
code --install-extension 4yue-vscode-plugin-0.0.1.vsix
```

You can also install it from VS Code with `Extensions: Install from VSIX...`.

### Configure the Compiler Path

If `4yue` is not on `PATH`, add this to your VS Code settings:

```json
{
    "4yue.executablePath": "E:\\projects\\c-projects\\4yue\\build\\4yue.exe"
}
```

## Example

```4yue
import std.math;

fn main(): i32 {
    let value: i32 = math.square(5);
    print("%d\n", value);
    return 0;
}
```
