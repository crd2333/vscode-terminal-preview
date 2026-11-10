const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findCandidates, resolvePath } = require('../src/paths');

const extensions = new Set(['png', 'jpg', 'mp4', 'svg']);

for (const [name, line, expected] of [
  ['ls columns and code', 'a.png  app.js  b.JPG  report.txt', ['a.png', 'b.JPG']],
  ['absolute outside workspace', '/ssd1/data/cat.png', ['/ssd1/data/cat.png']],
  ['relative, parent and home', './a.png ../b.jpg ~/data/c.png', ['./a.png', '../b.jpg', '~/data/c.png']],
  ['quoted spaces', '"/ssd1/my images/a.png" \'my video.mp4\'', ['/ssd1/my images/a.png', 'my video.mp4']],
  ['escaped spaces', String.raw`/ssd1/my\ images/a.png`, ['/ssd1/my images/a.png']],
  ['unicode', '🖼️ /ssd1/图片/猫.png', ['/ssd1/图片/猫.png']],
  ['punctuation and brackets', '(/ssd1/a.png), [b.jpg]; {c.svg}.', ['/ssd1/a.png', 'b.jpg', 'c.svg']],
  ['parentheses in names', '(first).png a(2).png', ['(first).png', 'a(2).png']],
  ['windows drive and UNC', String.raw`C:\data\a.png \\server\share\b.jpg`, [String.raw`C:\data\a.png`, String.raw`\\server\share\b.jpg`]],
  ['URLs untouched', 'https://example.com/a.png file:///tmp/b.png vscode://x/c.png', []],
  ['code and stack traces untouched', '/tmp/a.js:3:4 /src/b.ts /tmp/a.png.js', []],
  ['do not link media-looking directory', '/tmp/a.png/src.js', []],
  ['quoted paths preserve punctuation', '"a,.png" \'(b).png\'', ['a,.png', '(b).png']],
  ['empty input', '', []]
]) {
  test(name, () => {
    const candidates = findCandidates(line, extensions);
    assert.deepEqual(candidates.map(candidate => candidate.filePath), expected);
    for (const candidate of candidates) {
      const text = line.slice(candidate.startIndex, candidate.startIndex + candidate.length);
      assert.equal(text.replace(/\\([ \t])/g, '$1'), candidate.filePath);
    }
  });
}

test('candidate offsets use UTF-16 terminal API indices', () => {
  const line = '🖼️ "/ssd1/猫 图.png"';
  const [candidate] = findCandidates(line, extensions);
  assert.equal(candidate.startIndex, line.indexOf('/ssd1'));
  assert.equal(line.slice(candidate.startIndex, candidate.startIndex + candidate.length), '/ssd1/猫 图.png');
});

for (const [name, input, cwd, expected] of [
  ['absolute', '/ssd1/a.png', undefined, '/ssd1/a.png'],
  ['relative', 'a.png', '/ssd1/data', '/ssd1/data/a.png'],
  ['parent', '../a.png', '/ssd1/data', '/ssd1/a.png'],
  ['home', '~/images/a.png', '/tmp', '/home/test/images/a.png'],
  ['no cwd', 'a.png', undefined, undefined],
  ['other user home not guessed', '~other/a.png', '/tmp', undefined],
  ['windows paths not misread on Linux', String.raw`C:\data\a.png`, '/tmp', undefined]
]) {
  test('POSIX resolution: ' + name, () => {
    assert.equal(resolvePath(input, cwd, '/home/test', 'linux'), expected);
  });
}

for (const [name, input, cwd, expected] of [
  ['drive absolute', String.raw`D:\images\a.png`, undefined, String.raw`D:\images\a.png`],
  ['relative', String.raw`..\a.png`, String.raw`D:\images`, String.raw`D:\a.png`],
  ['home', String.raw`~\a.png`, undefined, String.raw`C:\Users\test\a.png`],
  ['UNC', String.raw`\\server\share\a.png`, undefined, String.raw`\\server\share\a.png`],
  ['root relative', String.raw`\a.png`, String.raw`D:\images`, String.raw`D:\a.png`],
  ['unknown drive', String.raw`\a.png`, undefined, undefined]
]) {
  test('Windows resolution: ' + name, () => {
    assert.equal(resolvePath(input, cwd, String.raw`C:\Users\test`, 'win32'), expected);
  });
}
