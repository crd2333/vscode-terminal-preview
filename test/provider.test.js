const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { URI } = require('vscode-uri');
const { createProvider } = require('../src/provider');
const manifest = require('../package.json');

function setup({ preview = true, extensions = ['png', 'jpg'], stat } = {}) {
  const commands = [];
  const errors = [];
  const stats = [];
  const settings = { preview, extensions };
  const api = {
    Uri: URI,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      getConfiguration(section) {
        return {
          get(key, fallback) {
            if (section === 'terminalMediaPreview' && key === 'extensions') return settings.extensions;
            if (section === 'workbench.editor' && key === 'enablePreview') return settings.preview;
            return fallback;
          }
        };
      },
      fs: {
        async stat(uri) {
          stats.push(uri);
          return stat ? stat(uri) : { type: 1 };
        }
      }
    },
    commands: { async executeCommand(...args) { commands.push(args); } },
    window: { async showErrorMessage(message) { errors.push(message); } }
  };
  return { provider: createProvider(api), api, commands, errors, stats, settings };
}

function context(line, cwd = URI.file('/ssd1/images')) {
  return { line, terminal: { shellIntegration: cwd ? { cwd } : undefined, creationOptions: {} } };
}
const token = () => ({ isCancellationRequested: false });

test('only media paths are statted and linked', async () => {
  const { provider, stats } = setup();
  const links = await provider.provideTerminalLinks(context('a.png app.ts:4:3 b.jpg'), token());
  assert.deepEqual(links.map(link => link.uri.path), ['/ssd1/images/a.png', '/ssd1/images/b.jpg']);
  assert.equal(stats.length, 2);
});

test('remote scheme and authority survive resolution, including absolute paths', async () => {
  const { provider } = setup();
  const cwd = URI.parse('vscode-remote://ssh-remote+gpu/ssd1/images');
  const links = await provider.provideTerminalLinks(context('a.png /other/b.jpg', cwd), token());
  assert.deepEqual(links.map(link => link.uri.toString(true)), [
    'vscode-remote://ssh-remote+gpu/ssd1/images/a.png',
    'vscode-remote://ssh-remote+gpu/other/b.jpg'
  ]);
});

test('non-files, missing files and inaccessible files fall through', async () => {
  const { provider } = setup({ stat: async uri => {
    if (uri.path.endsWith('/directory.png')) return { type: 2 };
    if (uri.path.endsWith('/link.png')) return { type: 65 };
    throw new Error('ENOENT or EACCES');
  } });
  const links = await provider.provideTerminalLinks(context('directory.png missing.png link.png'), token());
  assert.deepEqual(links.map(link => link.uri.path), ['/ssd1/images/link.png']);
});

test('unknown cwd: absolute paths work and relative paths are not guessed', async () => {
  const { provider } = setup();
  const links = await provider.provideTerminalLinks(context('a.png /ssd1/b.jpg', null), token());
  assert.deepEqual(links.map(link => link.uri.path), ['/ssd1/b.jpg']);
});

test('uses terminal initial cwd when shell integration is unavailable', async () => {
  const { provider } = setup();
  const ctx = { line: 'a.png', terminal: { creationOptions: { cwd: '/tmp' } } };
  const [link] = await provider.provideTerminalLinks(ctx, token());
  assert.equal(link.uri.path, '/tmp/a.png');
});

test('shell integration cwd takes precedence over initial cwd', async () => {
  const { provider } = setup();
  const ctx = context('a.png');
  ctx.terminal.creationOptions.cwd = '/stale';
  const [link] = await provider.provideTerminalLinks(ctx, token());
  assert.equal(link.uri.path, '/ssd1/images/a.png');
});

test('setting accepts leading dots, uppercase and user-defined types', async () => {
  const { provider } = setup({ extensions: ['.PNG', 'mp4'] });
  const links = await provider.provideTerminalLinks(context('a.png b.JPG c.mp4'), token());
  assert.deepEqual(links.map(link => link.uri.path), ['/ssd1/images/a.png', '/ssd1/images/c.mp4']);
});

test('empty media list disables interception', async () => {
  const { provider, stats } = setup({ extensions: [] });
  assert.deepEqual(await provider.provideTerminalLinks(context('a.png'), token()), []);
  assert.equal(stats.length, 0);
});

test('cancellation prevents filesystem work', async () => {
  const { provider, stats } = setup();
  assert.deepEqual(await provider.provideTerminalLinks(context('a.png'), { isCancellationRequested: true }), []);
  assert.equal(stats.length, 0);
});

test('cancellation during filesystem work discards results', async () => {
  const cancellation = token();
  const { provider } = setup({ stat: async () => {
    cancellation.isCancellationRequested = true;
    return { type: 1 };
  } });
  assert.deepEqual(await provider.provideTerminalLinks(context('a.png'), cancellation), []);
});

test('concurrent requests do not mix candidates or cwd', async () => {
  const { provider } = setup();
  const [a, b] = await Promise.all([
    provider.provideTerminalLinks(context('a.png', URI.file('/one')), token()),
    provider.provideTerminalLinks(context('b.jpg', URI.file('/two')), token())
  ]);
  assert.equal(a[0].uri.path, '/one/a.png');
  assert.equal(b[0].uri.path, '/two/b.jpg');
});

test('preview setting is read at click time, and false is explicitly respected', async () => {
  const { provider, commands, settings } = setup();
  const [link] = await provider.provideTerminalLinks(context('a.png'), token());
  await provider.handleTerminalLink(link);
  settings.preview = false;
  await provider.handleTerminalLink(link);
  assert.deepEqual(commands, [
    ['vscode.open', link.uri, { preview: true }],
    ['vscode.open', link.uri, { preview: false }]
  ]);
});

test('failed editor opens are reported', async () => {
  const { provider, api, errors } = setup();
  api.commands.executeCommand = async () => { throw new Error('Cannot open image'); };
  await provider.handleTerminalLink({ uri: URI.file('/tmp/a.png') });
  assert.deepEqual(errors, ['Terminal Media Preview: Cannot open image']);
});

test('real filesystem: outside-workspace file links, directories and missing paths do not', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-media-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, '图 像.png'), Buffer.from('test fixture'));
  await fs.mkdir(path.join(directory, 'directory.png'));
  const { provider } = setup({ stat: async uri => {
    const value = await fs.stat(uri.fsPath);
    return { type: value.isFile() ? 1 : 2 };
  } });
  const links = await provider.provideTerminalLinks(
    context('"图 像.png" directory.png missing.png code.ts', URI.file(directory)), token()
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].uri.fsPath, path.join(directory, '图 像.png'));
});

test('manifest activates on startup in workspace host with only media defaults', () => {
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.ok(manifest.activationEvents.includes('onStartupFinished'));
  const defaults = manifest.contributes.configuration.properties['terminalMediaPreview.extensions'].default;
  assert.ok(defaults.includes('png') && defaults.includes('jpg') && defaults.includes('mp4'));
  assert.ok(!defaults.includes('js') && !defaults.includes('ts') && !defaults.includes('py'));
});
