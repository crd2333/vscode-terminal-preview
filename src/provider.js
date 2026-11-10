const os = require('node:os');
const { findCandidates, resolvePath } = require('./paths');

function createProvider(vscode) {
  function getCwd(terminal) {
    const integrated = terminal.shellIntegration?.cwd;
    if (integrated) {
      return integrated;
    }
    const initial = terminal.creationOptions?.cwd;
    return typeof initial === 'string' ? vscode.Uri.file(initial) : initial;
  }

  return {
    async provideTerminalLinks(context, token) {
      if (token.isCancellationRequested) {
        return [];
      }
      const cwd = getCwd(context.terminal);
      const configured = vscode.workspace.getConfiguration('terminalMediaPreview', cwd)
        .get('extensions', []);
      const extensions = new Set(configured.map(value => value.replace(/^\./, '').toLowerCase()));
      const candidates = findCandidates(context.line, extensions);

      const links = await Promise.all(candidates.map(async candidate => {
        if (token.isCancellationRequested) {
          return undefined;
        }
        // Only filesystem-backed terminals are supported.
        if (cwd && cwd.scheme !== 'file' && cwd.scheme !== 'vscode-remote') {
          return undefined;
        }
        const resolved = resolvePath(candidate.filePath, cwd?.fsPath, os.homedir());
        if (!resolved) {
          return undefined;
        }
        const fileUri = vscode.Uri.file(resolved);
        // Keep the remote authority supplied by shell integration.
        const uri = cwd?.scheme === 'vscode-remote'
          ? cwd.with({ path: fileUri.path, query: '', fragment: '' })
          : fileUri;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (!(stat.type & vscode.FileType.File) || token.isCancellationRequested) {
            return undefined;
          }
          return {
            startIndex: candidate.startIndex,
            length: candidate.length,
            tooltip: 'Open Media (follows editor preview setting)',
            uri
          };
        } catch {
          // Nonexistent/inaccessible files are left to VS Code's other providers.
          return undefined;
        }
      }));
      return token.isCancellationRequested ? [] : links.filter(Boolean);
    },

    async handleTerminalLink(link) {
      const preview = vscode.workspace.getConfiguration('workbench.editor', link.uri)
        .get('enablePreview', true);
      try {
        // Use the default editor (including built-in/custom media editors).
        // VS Code manages preview replacement and double-click-to-keep itself.
        await vscode.commands.executeCommand('vscode.open', link.uri, { preview });
      } catch (error) {
        await vscode.window.showErrorMessage(
          `Terminal Media Preview: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  };
}

module.exports = { createProvider };
