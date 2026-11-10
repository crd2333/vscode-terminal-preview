const vscode = require('vscode');
const { createProvider } = require('./provider');

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider(createProvider(vscode))
  );
}

module.exports = { activate };
