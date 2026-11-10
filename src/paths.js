const path = require('node:path');

/**
 * Extract shell-style tokens, keeping terminal character offsets intact.
 * Unquoted spaces must be backslash-escaped; quoted paths may contain spaces.
 */
function findCandidates(line, extensions) {
  const tokens = /"([^"\r\n]+)"|'([^'\r\n]+)'|((?:\\[ \t]|[^\s"'<>|])+)/gu;
  const candidates = [];
  for (const match of line.matchAll(tokens)) {
    const quoted = match[3] === undefined;
    let text = match[1] ?? match[2] ?? match[3];
    let startIndex = match.index + (quoted ? 1 : 0);
    if (!quoted) {
      text = text.replace(/[.,;!?]+$/, '');
      const pairs = { '(': ')', '[': ']', '{': '}' };
      while (pairs[text[0]] && pairs[text[0]] === text.at(-1)) {
        text = text.slice(1, -1);
        startIndex++;
      }
    }
    const length = text.length;
    const filePath = quoted ? text : text.replace(/\\([ \t])/g, '$1');

    // Do not take over URLs, including file:// links, or drive-relative paths.
    if (/^[a-z][a-z\d+.-]*:/i.test(filePath) && !/^[a-z]:[\\/]/i.test(filePath)) {
      continue;
    }
    const extension = path.posix.extname(filePath).slice(1).toLowerCase();
    if (extensions.has(extension)) {
      candidates.push({ startIndex, length, filePath });
    }
  }
  return candidates;
}

function resolvePath(filePath, cwd, home, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (filePath.startsWith('~')) {
    if (!/^~(?:[\\/]|$)/.test(filePath)) {
      return undefined;
    }
    return paths.resolve(home, filePath.slice(2));
  }
  // A Windows drive or UNC path printed in a POSIX shell isn't a local path.
  if (platform !== 'win32' && /^(?:[a-z]:[\\/]|\\\\)/i.test(filePath)) {
    return undefined;
  }
  if (paths.isAbsolute(filePath)) {
    // On Windows, "\\image.png" needs the drive from the terminal's cwd.
    if (platform === 'win32' && !/^(?:[a-z]:|\\\\)/i.test(filePath)) {
      return cwd ? paths.resolve(cwd, filePath) : undefined;
    }
    return paths.normalize(filePath);
  }
  return cwd ? paths.resolve(cwd, filePath) : undefined;
}

module.exports = { findCandidates, resolvePath };
