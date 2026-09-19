# Changelog

## [Unreleased]

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
