"use strict";

const vscode = require("vscode");

const INCLUDE_GLOB = "**/*.{tp,tap}";
const DEFAULT_EXCLUDE = "**/build/**";

const BUILTINS = new Set(["print", "min", "max", "abs", "square"]);

const BUILTIN_TYPES = new Set([
    "int", "uint",
    "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64", "i128", "u128",
    "f32", "f64",
    "bool", "string", "array"
]);

const MAX_SIGNATURE_LINES = 6;
const MAX_HOVER_ENTRIES = 3;

const NAME = "([A-Za-z_][A-Za-z0-9_]*)";
const OPTIONAL_TYPE = "(?:\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*))?";

const FN_RE = new RegExp(`\\bfn\\s+${NAME}`, "g");
const LET_RE = new RegExp(`\\blet\\s+${NAME}${OPTIONAL_TYPE}`, "g");
const CONST_RE = new RegExp(`\\bconst\\s+${NAME}${OPTIONAL_TYPE}`, "g");
const STRUCT_RE = new RegExp(`\\bstruct\\s+${NAME}`, "g");
const ENUM_RE = new RegExp(`\\benum\\s+${NAME}`, "g");
const PARAM_LIST_RE = /\bfn\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
const PARAM_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const IDENT_RE = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

const DECL_PATTERNS = [
    { pattern: FN_RE, kind: vscode.SymbolKind.Function, detail: "fn" },
    { pattern: LET_RE, kind: vscode.SymbolKind.Variable, detail: "let", typed: true },
    { pattern: CONST_RE, kind: vscode.SymbolKind.Constant, detail: "const", typed: true },
    { pattern: STRUCT_RE, kind: vscode.SymbolKind.Struct, detail: "struct" },
    { pattern: ENUM_RE, kind: vscode.SymbolKind.Enum, detail: "enum" }
];

class SymbolIndex {
    constructor() {
        this.cache = new Map();
        this.uris = undefined;
        this.watcher = undefined;
    }

    dispose() {
        if (this.watcher) this.watcher.dispose();
    }

    async allUris() {
        if (!this.uris) {
            const config = vscode.workspace.getConfiguration("tap");
            const exclude = config.get("indexExclude", DEFAULT_EXCLUDE);
            this.uris = await vscode.workspace.findFiles(
                INCLUDE_GLOB,
                typeof exclude === "string" && exclude.trim() ? exclude.trim() : undefined
            );
        }
        return this.uris;
    }

    invalidateFileList() {
        this.uris = undefined;
    }

    drop(uri) {
        this.cache.delete(uri.toString());
    }

    dropAll() {
        this.cache.clear();
    }

    async scan(uri) {
        const key = uri.toString();
        const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
        let document = open;

        if (!document) {
            try {
                document = await vscode.workspace.openTextDocument(uri);
            } catch (error) {
                return undefined;
            }
        }

        const stamp = open ? open.version : 0;
        const cached = this.cache.get(key);
        if (cached && cached.stamp === stamp) {
            return cached;
        }

        const result = scanDocument(document);
        result.stamp = stamp;
        this.cache.set(key, result);
        return result;
    }

    async findSymbols(name) {
        const entries = [];
        for (const uri of await this.allUris()) {
            const scanned = await this.scan(uri);
            if (!scanned) continue;
            for (const symbol of scanned.symbols) {
                if (symbol.name === name) {
                    entries.push({ uri, symbol });
                }
            }
        }
        return entries;
    }

    async definitions(name) {
        return (await this.findSymbols(name)).map(
            (entry) => new vscode.Location(entry.uri, entry.symbol.selectionRange)
        );
    }

    async typeDefinitionOf(name) {
        for (const uri of await this.allUris()) {
            const scanned = await this.scan(uri);
            if (!scanned) continue;

            const declaration = scanned.symbols.find((symbol) => symbol.name === name && symbol.typeName);
            if (declaration) {
                return {
                    typeName: declaration.typeName,
                    locations: await this.definitions(declaration.typeName)
                };
            }
        }

        return undefined;
    }

    async references(name) {
        const locations = [];
        for (const uri of await this.allUris()) {
            const scanned = await this.scan(uri);
            if (!scanned) continue;
            for (const occurrence of scanned.occurrences) {
                if (occurrence.name === name) {
                    locations.push(new vscode.Location(uri, occurrence.range));
                }
            }
        }
        return locations;
    }

    async workspaceSymbols(query) {
        const needle = (query || "").toLowerCase();
        const symbols = [];

        for (const uri of await this.allUris()) {
            const scanned = await this.scan(uri);
            if (!scanned) continue;
        for (const symbol of scanned.symbols) {
            if (symbol.parameter) continue;
            if (!needle || symbol.name.toLowerCase().includes(needle)) {
                symbols.push(new vscode.SymbolInformation(
                    symbol.name,
                    symbol.kind,
                    "",
                    new vscode.Location(uri, symbol.selectionRange)
                ));
            }
        }
        }

        return symbols;
    }
}

function scanDocument(document) {
    const symbols = [];
    const occurrences = [];
    const state = { inBlockComment: false, inString: false };

    for (let line = 0; line < document.lineCount; line++) {
        const raw = document.lineAt(line).text;
        const masked = maskLine(raw, state);

        for (const declaration of DECL_PATTERNS) {
            declaration.pattern.lastIndex = 0;
            let match;
            while ((match = declaration.pattern.exec(masked))) {
                const start = match.index + match[0].indexOf(match[1]);
                symbols.push({
                    name: match[1],
                    kind: declaration.kind,
                    detail: declaration.detail,
                    typeName: declaration.typed ? match[2] : undefined,
                    range: blockRange(document, line),
                    selectionRange: rangeAt(line, start, match[1].length)
                });
            }
        }

        PARAM_LIST_RE.lastIndex = 0;
        let parameterList;
        while ((parameterList = PARAM_LIST_RE.exec(masked))) {
            const listStart = parameterList.index + parameterList[0].indexOf(parameterList[1]);
            PARAM_RE.lastIndex = 0;
            let parameter;
            while ((parameter = PARAM_RE.exec(parameterList[1]))) {
                const start = listStart + parameter.index + parameter[0].indexOf(parameter[1]);
                symbols.push({
                    name: parameter[1],
                    kind: vscode.SymbolKind.Variable,
                    detail: "param",
                    typeName: parameter[2],
                    parameter: true,
                    signature: `${parameter[1]}: ${parameter[2]}`,
                    range: rangeAt(line, start, parameter[1].length),
                    selectionRange: rangeAt(line, start, parameter[1].length)
                });
            }
        }

        IDENT_RE.lastIndex = 0;
        let identifier;
        while ((identifier = IDENT_RE.exec(masked))) {
            occurrences.push({
                name: identifier[0],
                range: rangeAt(line, identifier.index, identifier[0].length)
            });
        }
    }

    for (const symbol of symbols) {
        symbol.signature = signatureOf(document, symbol);
        if (symbol.kind === vscode.SymbolKind.Struct || symbol.kind === vscode.SymbolKind.Enum) {
            symbol.members = membersOf(document, symbol);
        }
    }

    return { symbols, occurrences };
}

function signatureOf(document, symbol) {
    const start = symbol.range.start.line;
    const limit = Math.min(symbol.range.end.line, start + MAX_SIGNATURE_LINES - 1);
    let text = "";

    for (let line = start; line <= limit; line++) {
        text += (text ? " " : "") + document.lineAt(line).text.trim();
        if (text.includes("{")) break;
    }

    return text
        .replace(/[ \t]*=[^=].*$/, "")
        .replace(/[ \t]*\{.*$/, "")
        .replace(/[ \t]*;[ \t]*$/, "")
        .trim();
}

function membersOf(document, symbol) {
    const members = [];
    const state = { inBlockComment: false, inString: false };

    for (let line = symbol.range.start.line + 1; line < symbol.range.end.line; line++) {
        const raw = document.lineAt(line).text;
        const masked = maskLine(raw, state);

        const field = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*([^,]+?)[ \t]*,?[ \t]*$/.exec(masked);
        if (field) {
            members.push(`${field[1]}: ${raw.slice(raw.indexOf(":") + 1).trim().replace(/,$/, "")}`);
            continue;
        }

        const variant = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*(\(([^)]*)\))?[ \t]*,?[ \t]*$/.exec(masked);
        if (variant) {
            members.push(variant[2] ? `${variant[1]}(${variant[3].trim()})` : variant[1]);
        }
    }

    return members;
}

function maskLine(text, state) {
    const chars = text.split("");
    const blank = (from, to) => {
        for (let i = from; i < to && i < chars.length; i++) {
            if (chars[i] !== "\t") chars[i] = " ";
        }
    };

    let i = 0;
    while (i < text.length) {
        if (state.inBlockComment) {
            const end = text.indexOf("*/", i);
            if (end === -1) {
                blank(i, text.length);
                i = text.length;
            } else {
                blank(i, end + 2);
                i = end + 2;
                state.inBlockComment = false;
            }
            continue;
        }

        if (state.inString) {
            let j = i;
            while (j < text.length) {
                if (text[j] === "\\") {
                    j += 2;
                    continue;
                }
                if (text[j] === "\"") {
                    j++;
                    state.inString = false;
                    break;
                }
                j++;
            }
            blank(i, j);
            i = j;
            continue;
        }

        if (text.startsWith("//", i)) {
            blank(i, text.length);
            break;
        }

        if (text.startsWith("/*", i)) {
            state.inBlockComment = true;
            blank(i, i + 2);
            i += 2;
            continue;
        }

        if (text[i] === "\"") {
            state.inString = true;
            blank(i, i + 1);
            i += 1;
            continue;
        }

        i++;
    }

    return chars.join("");
}

function blockRange(document, startLine) {
    const state = { inBlockComment: false, inString: false };
    let depth = 0;
    let end = startLine;

    for (let line = startLine; line < document.lineCount; line++) {
        const masked = maskLine(document.lineAt(line).text, state);
        for (const char of masked) {
            if (char === "{") depth++;
            else if (char === "}") depth--;
        }
        if (depth <= 0) {
            end = line;
            break;
        }
        end = line;
    }

    const indent = indentOf(document.lineAt(startLine).text);
    const last = document.lineAt(end).text;
    return new vscode.Range(startLine, indent, end, Math.max(last.length, indent));
}

function indentOf(text) {
    return text.length - text.replace(/^[ \t]+/, "").length;
}

function rangeAt(line, start, length) {
    return new vscode.Range(line, start, line, start + length);
}

function wordAt(document, position) {
    const range = document.getWordRangeAtPosition(position);
    return range ? { name: document.getText(range), range } : undefined;
}

async function provideDefinition(index, document, position) {
    const word = wordAt(document, position);
    if (!word) return undefined;

    const definitions = await index.definitions(word.name);
    if (definitions.length) return definitions;

    if (BUILTINS.has(word.name)) {
        vscode.window.setStatusBarMessage(`tap: ${word.name} is a builtin function`, 3000);
    } else if (BUILTIN_TYPES.has(word.name)) {
        vscode.window.setStatusBarMessage(`tap: ${word.name} is a builtin type`, 3000);
    }

    return undefined;
}

async function provideTypeDefinition(index, document, position) {
    const word = wordAt(document, position);
    if (!word) return undefined;

    const found = await index.typeDefinitionOf(word.name);
    if (!found) return undefined;

    if (found.locations.length) return found.locations;

    vscode.window.setStatusBarMessage(`tap: ${word.name} is ${found.typeName}, a builtin type`, 3000);
    return undefined;
}

async function provideHover(index, document, position) {
    const word = wordAt(document, position);
    if (!word) return undefined;

    const entries = await index.findSymbols(word.name);
    if (!entries.length) {
        return builtinHover(word.name);
    }

    const markdown = new vscode.MarkdownString();
    const shown = entries.slice(0, MAX_HOVER_ENTRIES);

    for (const entry of shown) {
        if (shown.indexOf(entry) > 0) markdown.appendMarkdown("\n\n---\n\n");
        appendSymbol(markdown, entry);
        await appendTypeOf(markdown, index, entry.symbol);
    }

    if (entries.length > shown.length) {
        markdown.appendMarkdown(`\n\n_…and ${entries.length - shown.length} more declaration(s)_`);
    }

    return new vscode.Hover(markdown, word.range);
}

function appendSymbol(markdown, entry) {
    const symbol = entry.symbol;
    const file = vscode.workspace.asRelativePath(entry.uri, false);
    const line = symbol.selectionRange.start.line + 1;

    markdown.appendMarkdown(`_${kindLabel(symbol.kind, symbol)}_ — \`${file}:${line}\`\n\n`);
    markdown.appendCodeblock(symbol.signature || `${symbol.detail} ${symbol.name}`, "tap");

    const members = symbol.members || [];
    if (members.length) {
        markdown.appendMarkdown("\n\n");
        for (const member of members) {
            markdown.appendMarkdown(`- \`${member}\`\n`);
        }
    }
}

async function appendTypeOf(markdown, index, symbol) {
    if (!symbol.typeName) return;

    const typeEntries = await index.findSymbols(symbol.typeName);
    const type = typeEntries.find(
        (entry) => entry.symbol.kind === vscode.SymbolKind.Struct || entry.symbol.kind === vscode.SymbolKind.Enum
    );

    markdown.appendMarkdown(`\n\n**type** \`${symbol.typeName}\`\n\n`);
    if (!type) {
        markdown.appendMarkdown(BUILTIN_TYPES.has(symbol.typeName)
            ? "_builtin type_"
            : "_unknown type_");
        return;
    }

    markdown.appendCodeblock(type.symbol.signature, "tap");
    const members = type.symbol.members || [];
    if (members.length) {
        markdown.appendMarkdown("\n\n");
        for (const member of members) {
            markdown.appendMarkdown(`- \`${member}\`\n`);
        }
    }
}

function builtinHover(name) {
    if (!BUILTINS.has(name) && !BUILTIN_TYPES.has(name)) return undefined;

    const markdown = new vscode.MarkdownString();
    markdown.appendCodeblock(BUILTINS.has(name) ? `fn ${name}(...)` : `${name} (builtin type)`, "tap");
    return new vscode.Hover(markdown);
}

function kindLabel(kind, symbol) {
    if (symbol && symbol.parameter) return "parameter";
    switch (kind) {
        case vscode.SymbolKind.Function: return "function";
        case vscode.SymbolKind.Variable: return "variable";
        case vscode.SymbolKind.Constant: return "constant";
        case vscode.SymbolKind.Struct: return "struct";
        case vscode.SymbolKind.Enum: return "enum";
        default: return "declaration";
    }
}

function registerNavigation(context) {
    const config = vscode.workspace.getConfiguration("tap");
    if (!config.get("enableNavigation", true)) {
        return undefined;
    }

    const index = new SymbolIndex();
    const selector = { language: "tap" };

    context.subscriptions.push(index);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(selector, {
            provideDefinition: (document, position) => provideDefinition(index, document, position)
        })
    );
    context.subscriptions.push(
        vscode.languages.registerTypeDefinitionProvider(selector, {
            provideTypeDefinition: (document, position) => provideTypeDefinition(index, document, position)
        })
    );
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(selector, {
            provideHover: (document, position) => provideHover(index, document, position)
        })
    );
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(selector, {
            provideReferences: (document, position) => {
                const word = wordAt(document, position);
                return word ? index.references(word.name) : [];
            }
        })
    );
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(selector, {
            provideDocumentSymbols: (document) => {
                const scanned = scanDocument(document);
                return scanned.symbols
                    .filter((symbol) => !symbol.parameter)
                    .map((symbol) => new vscode.DocumentSymbol(
                        symbol.name,
                        symbol.detail,
                        symbol.kind,
                        symbol.range,
                        symbol.selectionRange
                    ));
            }
        })
    );
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider({
            provideWorkspaceSymbols: (query) => index.workspaceSymbols(query)
        })
    );

    const watcher = vscode.workspace.createFileSystemWatcher(INCLUDE_GLOB);
    watcher.onDidCreate((uri) => {
        index.invalidateFileList();
        index.drop(uri);
    });
    watcher.onDidDelete((uri) => {
        index.invalidateFileList();
        index.drop(uri);
    });
    watcher.onDidChange((uri) => index.drop(uri));
    index.watcher = watcher;

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => index.drop(document.uri)),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("tap.indexExclude")) {
                index.invalidateFileList();
                index.dropAll();
            }
        })
    );

    return index;
}

module.exports = {
    SymbolIndex,
    scanDocument,
    maskLine,
    provideHover,
    registerNavigation
};
