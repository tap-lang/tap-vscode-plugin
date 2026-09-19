"use strict";

const childProcess = require("child_process");
const path = require("path");
const vscode = require("vscode");
const symbols = require("./symbols");

const DIAGNOSTIC_SOURCE = "tap";
const COMMANDS = [
    {
        id: "tap.compileFile",
        label: "Compile",
        configKey: "compileArgs",
        defaultArgs: []
    },
    {
        id: "tap.runFile",
        label: "Run",
        configKey: "runArgs",
        defaultArgs: ["run"]
    },
    {
        id: "tap.emitIR",
        label: "Emit LLVM IR",
        configKey: "emitIRArgs",
        defaultArgs: ["-ir"]
    },
    {
        id: "tap.lexFile",
        label: "Lex",
        configKey: "lexArgs",
        defaultArgs: ["-lex"]
    },
    {
        id: "tap.parseFile",
        label: "Parse",
        configKey: "parseArgs",
        defaultArgs: ["-parse"]
    }
];

let outputChannel;
let diagnosticCollection;

function activate(context) {
    outputChannel = vscode.window.createOutputChannel("tap");
    diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);

    context.subscriptions.push(outputChannel);
    context.subscriptions.push(diagnosticCollection);

    for (const command of COMMANDS) {
        context.subscriptions.push(
            vscode.commands.registerCommand(command.id, (resourceUri) => runCompiler(command, resourceUri))
        );
    }

    symbols.registerNavigation(context);
}

function deactivate() {}

async function getSourceFile(resourceUri) {
    if (resourceUri && resourceUri.scheme === "file") {
        return resourceUri;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a tap source file first.");
        return undefined;
    }

    const document = editor.document;
    if (document.uri.scheme !== "file") {
        vscode.window.showWarningMessage("tap commands can only run saved files.");
        return undefined;
    }

    if (document.isDirty) {
        const saved = await document.save();
        if (!saved) {
            vscode.window.showWarningMessage("Save the file before running tap.");
            return undefined;
        }
    }

    return document.uri;
}

async function runCompiler(command, resourceUri) {
    const sourceUri = await getSourceFile(resourceUri);
    if (!sourceUri) return;

    const config = vscode.workspace.getConfiguration("tap");
    const executablePath = config.get("executablePath", "tap");
    const executable = typeof executablePath === "string" ? executablePath.trim() : "tap";
    if (!executable) {
        vscode.window.showErrorMessage("Set tap.executablePath before running the tap compiler.");
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
    const defaultCwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(sourceUri.fsPath);
    const cwd = resolveWorkingDirectory(config.get("workingDirectory", ""), sourceUri, workspaceFolder) || defaultCwd;
    const compilerArgs = getStringArray(config, "compilerArgs", []);
    const actionArgs = getStringArray(config, command.configKey, command.defaultArgs);
    const commandArgs = [...compilerArgs, ...actionArgs, sourceUri.fsPath];

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`> ${formatArgument(executable)} ${commandArgs.map(formatArgument).join(" ")}`);
    outputChannel.appendLine("");

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `tap: ${command.label}`,
        cancellable: true
    }, (_progress, token) => {
        return executeCompiler(executable, commandArgs, {
            actionLabel: command.label,
            cwd,
            env: processEnv(config, sourceUri, workspaceFolder, cwd),
            sourceUri,
            token
        });
    });
}

function executeCompiler(executable, commandArgs, options) {
    return new Promise((resolve) => {
        const child = childProcess.spawn(executable, commandArgs, {
            cwd: options.cwd,
            env: options.env,
            shell: false
        });

        let finished = false;
        let wasCancelled = false;
        let compilerOutput = "";

        const cancellation = options.token.onCancellationRequested(() => {
            wasCancelled = true;
            outputChannel.appendLine("");
            outputChannel.appendLine("Cancelling tap compiler...");
            child.kill();
        });

        child.stdout.on("data", (data) => {
            const text = data.toString();
            compilerOutput += text;
            outputChannel.append(text);
        });

        child.stderr.on("data", (data) => {
            const text = data.toString();
            compilerOutput += text;
            outputChannel.append(text);
        });

        child.on("error", (error) => {
            if (finished) return;
            finished = true;
            cancellation.dispose();
            outputChannel.appendLine("");
            outputChannel.appendLine(`Failed to start tap: ${error.message}`);
            vscode.window.showErrorMessage("Could not start the tap compiler. Check tap.executablePath.");
            resolve();
        });

        child.on("close", (code, signal) => {
            if (finished) return;
            finished = true;
            cancellation.dispose();

            updateDiagnostics(compilerOutput, options.sourceUri, options.cwd);

            outputChannel.appendLine("");
            if (wasCancelled) {
                outputChannel.appendLine(`tap ${options.actionLabel.toLowerCase()} was cancelled.`);
                vscode.window.setStatusBarMessage(`tap: ${options.actionLabel} cancelled`, 3000);
            } else if (signal) {
                outputChannel.appendLine(`tap ${options.actionLabel.toLowerCase()} stopped by signal ${signal}.`);
                vscode.window.showErrorMessage(`tap: ${options.actionLabel} stopped by signal ${signal}.`);
            } else {
                outputChannel.appendLine(`tap ${options.actionLabel.toLowerCase()} finished with exit code ${code}.`);
                if (code === 0) {
                    vscode.window.setStatusBarMessage(`tap: ${options.actionLabel} succeeded`, 3000);
                } else {
                    vscode.window.showErrorMessage(`tap: ${options.actionLabel} failed with exit code ${code}.`);
                }
            }

            resolve();
        });
    });
}

function getStringArray(config, key, defaultValue) {
    const value = config.get(key, defaultValue);
    if (!Array.isArray(value)) {
        return defaultValue;
    }

    return value.filter((item) => typeof item === "string");
}

function resolveWorkingDirectory(value, sourceUri, workspaceFolder) {
    if (typeof value !== "string" || !value.trim()) {
        return undefined;
    }

    const expanded = expandVariables(value.trim(), sourceUri, workspaceFolder);
    return path.isAbsolute(expanded)
        ? expanded
        : path.resolve(workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(sourceUri.fsPath), expanded);
}

function getEnvironment(config, sourceUri, workspaceFolder, cwd) {
    const value = config.get("environment", {});
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const environment = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string") {
            environment[key] = expandVariables(item, sourceUri, workspaceFolder, cwd);
        }
    }

    return environment;
}

function expandVariables(value, sourceUri, workspaceFolder, cwd) {
    const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : "";
    const filePath = sourceUri.fsPath;
    const fileDirname = path.dirname(filePath);

    return value
        .replace(/\$\{workspaceFolder\}/g, workspacePath)
        .replace(/\$\{file\}/g, filePath)
        .replace(/\$\{fileDirname\}/g, fileDirname)
        .replace(/\$\{cwd\}/g, cwd || workspacePath || fileDirname);
}

function updateDiagnostics(output, sourceUri, cwd) {
    const config = vscode.workspace.getConfiguration("tap");
    if (!config.get("enableDiagnostics", true) || !diagnosticCollection) {
        return;
    }

    if (config.get("clearDiagnosticsOnRun", true)) {
        diagnosticCollection.clear();
    }

    const diagnosticsByFile = parseDiagnostics(output, sourceUri, cwd);
    for (const [uriString, diagnostics] of diagnosticsByFile.entries()) {
        diagnosticCollection.set(vscode.Uri.parse(uriString), diagnostics);
    }
}

function parseDiagnostics(output, sourceUri, cwd) {
    const diagnosticsByFile = new Map();

    for (const line of output.split(/\r?\n/)) {
        const diagnostic = parseDiagnosticLine(line, sourceUri, cwd);
        if (!diagnostic) continue;

        const uriString = diagnostic.uri.toString();
        const diagnostics = diagnosticsByFile.get(uriString) || [];
        diagnostics.push(diagnostic.diagnostic);
        diagnosticsByFile.set(uriString, diagnostics);
    }

    return diagnosticsByFile;
}

function parseDiagnosticLine(line, sourceUri, cwd) {
    const trimmed = line.trim();
    if (!trimmed) return undefined;

    const location = parseFileLocationDiagnostic(trimmed, sourceUri, cwd)
        || parseParenthesizedLocationDiagnostic(trimmed, sourceUri, cwd)
        || parseCurrentFileDiagnostic(trimmed, sourceUri)
        || parseSeverityOnlyDiagnostic(trimmed, sourceUri);

    if (!location) return undefined;

    const range = createDiagnosticRange(location.uri, location.line, location.column);
    const diagnostic = new vscode.Diagnostic(
        range,
        location.message || trimmed,
        severityFromText(location.severity)
    );
    diagnostic.source = DIAGNOSTIC_SOURCE;

    return {
        uri: location.uri,
        diagnostic
    };
}

function parseFileLocationDiagnostic(line, sourceUri, cwd) {
    const match = line.match(/^(.*?):(\d+)(?::(\d+))?(?::|\s+-)\s*(error|warning|info|note)\s*:?\s*(.+)$/i);
    if (!match) return undefined;

    const uri = resolveDiagnosticUri(match[1], sourceUri, cwd);
    if (!uri) return undefined;

    return {
        uri,
        line: Number(match[2]),
        column: match[3] ? Number(match[3]) : 1,
        severity: match[4],
        message: match[5]
    };
}

function parseParenthesizedLocationDiagnostic(line, sourceUri, cwd) {
    const match = line.match(/^(.*?)\((\d+)(?:,(\d+))?\)\s*:?\s*(error|warning|info|note)\s*:?\s*(.+)$/i);
    if (!match) return undefined;

    const uri = resolveDiagnosticUri(match[1], sourceUri, cwd);
    if (!uri) return undefined;

    return {
        uri,
        line: Number(match[2]),
        column: match[3] ? Number(match[3]) : 1,
        severity: match[4],
        message: match[5]
    };
}

function parseCurrentFileDiagnostic(line, sourceUri) {
    const match = line.match(/^line\s+(\d+)(?:\s*[:,]\s*(?:column|col)?\s*(\d+))?\s*:?\s*(error|warning|info|note)\s*:?\s*(.+)$/i);
    if (!match) return undefined;

    return {
        uri: sourceUri,
        line: Number(match[1]),
        column: match[2] ? Number(match[2]) : 1,
        severity: match[3],
        message: match[4]
    };
}

function parseSeverityOnlyDiagnostic(line, sourceUri) {
    const match = line.match(/^(error|warning|info|note)\s*:?\s*(.+)$/i);
    if (!match) return undefined;

    return {
        uri: sourceUri,
        line: 1,
        column: 1,
        severity: match[1],
        message: match[2]
    };
}

function resolveDiagnosticUri(fileName, sourceUri, cwd) {
    const normalizedFileName = fileName.trim();
    if (!normalizedFileName || normalizedFileName === "<stdin>") {
        return undefined;
    }

    if (normalizedFileName === path.basename(sourceUri.fsPath)) {
        return sourceUri;
    }

    const absolutePath = path.isAbsolute(normalizedFileName)
        ? normalizedFileName
        : path.resolve(cwd, normalizedFileName);
    return vscode.Uri.file(absolutePath);
}

function createDiagnosticRange(uri, oneBasedLine, oneBasedColumn) {
    const line = Math.max(oneBasedLine - 1, 0);
    const column = Math.max(oneBasedColumn - 1, 0);
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());

    if (!document || line >= document.lineCount) {
        return new vscode.Range(line, column, line, column + 1);
    }

    const lineText = document.lineAt(line).text;
    const start = Math.min(column, lineText.length);
    const end = Math.min(start + 1, lineText.length);
    return new vscode.Range(line, start, line, end);
}

function severityFromText(value) {
    switch ((value || "error").toLowerCase()) {
        case "warning":
            return vscode.DiagnosticSeverity.Warning;
        case "info":
        case "note":
            return vscode.DiagnosticSeverity.Information;
        default:
            return vscode.DiagnosticSeverity.Error;
    }
}

function processEnv(config, sourceUri, workspaceFolder, cwd) {
    return Object.assign({}, process.env, getEnvironment(config, sourceUri, workspaceFolder, cwd));
}

function formatArgument(value) {
    return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

module.exports = {
    activate,
    deactivate
};
