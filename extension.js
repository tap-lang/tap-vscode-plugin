"use strict";

const childProcess = require("child_process");
const path = require("path");
const vscode = require("vscode");

let outputChannel;

function activate(context) {
    outputChannel = vscode.window.createOutputChannel("4yue");
    context.subscriptions.push(outputChannel);

    context.subscriptions.push(
        vscode.commands.registerCommand("4yue.runFile", (resourceUri) => runCompiler(["run"], "Run", resourceUri)),
        vscode.commands.registerCommand("4yue.emitIR", (resourceUri) => runCompiler(["-ir"], "Emit LLVM IR", resourceUri)),
        vscode.commands.registerCommand("4yue.lexFile", (resourceUri) => runCompiler(["-lex"], "Lex", resourceUri)),
        vscode.commands.registerCommand("4yue.parseFile", (resourceUri) => runCompiler(["-parse"], "Parse", resourceUri))
    );
}

function deactivate() {}

async function getSourceFile(resourceUri) {
    if (resourceUri && resourceUri.scheme === "file") {
        return resourceUri;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a 4yue source file first.");
        return undefined;
    }

    const document = editor.document;
    if (document.uri.scheme !== "file") {
        vscode.window.showWarningMessage("4yue commands can only run saved files.");
        return undefined;
    }

    if (document.isDirty) {
        const saved = await document.save();
        if (!saved) {
            vscode.window.showWarningMessage("Save the file before running 4yue.");
            return undefined;
        }
    }

    return document.uri;
}

async function runCompiler(args, actionLabel, resourceUri) {
    const sourceUri = await getSourceFile(resourceUri);
    if (!sourceUri) return;

    const executable = vscode.workspace.getConfiguration("4yue").get("executablePath", "4yue");
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(sourceUri.fsPath);
    const commandArgs = [...args, sourceUri.fsPath];

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`> ${executable} ${commandArgs.map(formatArgument).join(" ")}`);
    outputChannel.appendLine("");

    const child = childProcess.spawn(executable, commandArgs, {
        cwd,
        env: processEnv(),
        shell: false
    });

    child.stdout.on("data", (data) => outputChannel.append(data.toString()));
    child.stderr.on("data", (data) => outputChannel.append(data.toString()));

    child.on("error", (error) => {
        outputChannel.appendLine("");
        outputChannel.appendLine(`Failed to start 4yue: ${error.message}`);
        vscode.window.showErrorMessage("Could not start the 4yue compiler. Check 4yue.executablePath.");
    });

    child.on("close", (code) => {
        outputChannel.appendLine("");
        outputChannel.appendLine(`4yue ${actionLabel.toLowerCase()} finished with exit code ${code}.`);
        if (code === 0) {
            vscode.window.setStatusBarMessage(`4yue: ${actionLabel} succeeded`, 3000);
        } else {
            vscode.window.showErrorMessage(`4yue: ${actionLabel} failed with exit code ${code}.`);
        }
    });
}

function processEnv() {
    return Object.assign({}, process.env);
}

function formatArgument(value) {
    return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

module.exports = {
    activate,
    deactivate
};
