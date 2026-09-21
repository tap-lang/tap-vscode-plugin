# Changelog

## [Unreleased]


- [2026-09-21] Highlight the missing keywords `const`, `struct`, `enum`,
  `extern`, `while`, `match`, and `sizeof`, the operators `=>`, `!`, `%`, and
  `&`, and user-defined type names in declarations, annotations, and struct
  literals.
- [2026-09-21] Give function definition names `entity.name.function.definition`
  instead of `support.function.call`.
- [2026-09-21] Index `const`, `struct`, and `enum` declarations, add go to type
  definition from a variable to its declared type, and recognize builtin types.
- [2026-09-19] Highlight `- .stdout` / `- .stderr` / `- .exit` test expectations inside
  `-- test` blocks. `.stdout` and `.exit` use `markup.inserted` (green) and
  `.stderr` uses `invalid` (red) in the default VS Code themes.
- [2026-09-19] Add go to definition, find references, document symbols, and
  workspace symbol search backed by a workspace index of `fn` and `let`
  declarations.
- [2026-09-19] Add `tap.enableNavigation` and `tap.indexExclude` settings.
- Rename the language extension to tap.
- Add `.tp` and `.tap` file association.
- Add richer tap syntax highlighting, snippets, and language configuration.
- Add commands for run, LLVM IR emission, lexing, and parsing.
- Add compile command, configurable compiler arguments, compiler environment
  variables, cancellation support, Problems diagnostics, and a `$tap` task
  problem matcher.
