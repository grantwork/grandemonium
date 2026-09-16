import {
  existsSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';

describe('Collab documentation', () => {
  it('keeps the documented Obsidian requirement synchronized with tooling', () => {
    const manifest = JSON.parse(readFileSync(path.resolve('manifest.json'), 'utf8')) as {
      minAppVersion: string;
    };
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    const readme = readFileSync(path.resolve('README.md'), 'utf8');

    expect(packageJson.devDependencies.obsidian).toBe(manifest.minAppVersion);
    expect(readme).toContain(`- Obsidian ${manifest.minAppVersion} or newer`);
  });

  it('links the concise Collab overview to its documentation and states the LAN boundary', () => {
    const readme = readFileSync(path.resolve('README.md'), 'utf8');

    for (const disclosure of [
      '## Collab mode',
      'Collab mode additionally needs [Git](https://git-scm.com/install/)',
      'between invited devices on the local network',
      'Project data does not reach any cloud service',
    ]) {
      expect(readme).toContain(disclosure);
    }
  });

  it('keeps every scoped Claude guide as an import of its adjacent agent guide', () => {
    for (const agentsPath of findFiles(path.resolve('.'), 'AGENTS.md')) {
      if (agentsPath.includes(`${path.sep}node_modules${path.sep}`)) continue;
      const claudePath = path.join(path.dirname(agentsPath), 'CLAUDE.md');

      expect(existsSync(claudePath)).toBe(true);
      expect(readFileSync(claudePath, 'utf8').trim()).toBe('@AGENTS.md');
    }
  });

  it('keeps README local file links resolvable', () => {
    const readme = readFileSync(path.resolve('README.md'), 'utf8');
    const markdownTargets = [...readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
      .map(match => match[1]);
    const htmlTargets = [...readme.matchAll(/\bsrc="([^"]+)"/g)]
      .map(match => match[1]);
    const localTargets = [...markdownTargets, ...htmlTargets]
      .filter(target => !/^(?:#|https?:|mailto:)/.test(target));

    for (const target of localTargets) {
      const filePath = target.replace(/^<|>$/g, '').split('#', 1)[0];
      expect(existsSync(path.resolve(filePath))).toBe(true);
    }
  });
});

function findFiles(directory: string, name: string): string[] {
  const matches: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(entryPath, name));
    else if (entry.isFile() && entry.name === name) matches.push(entryPath);
  }
  return matches;
}
