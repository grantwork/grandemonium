import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Plugin settings styles', () => {
  it('removes only the verified static orphans and retains the colliding item and status selectors', () => {
    const css = readFileSync(path.resolve('src/style/settings/plugin-settings.css'), 'utf8');

    for (const orphan of [
      'grandemonium-plugin-error-badge',
      'grandemonium-plugin-item-error',
      'grandemonium-plugin-preview',
      'grandemonium-plugin-preview-error',
      'grandemonium-plugin-status-error',
      'grandemonium-plugin-version-badge',
    ]) {
      expect(css).not.toContain(orphan);
    }

    expect(css).toContain('.grandemonium-plugin-item {');
    expect(css).toContain('.grandemonium-plugin-item-disabled {');
    expect(css).toContain('.grandemonium-plugin-status {');
    expect(css).toContain('.grandemonium-plugin-status-enabled {');
    expect(css).toContain('.grandemonium-plugin-status-disabled {');
  });
});
