import { readFileSync } from 'node:fs';
import path from 'node:path';

const FEATURE_STYLES = [
  'collab-access.css',
  'collab-comments.css',
  'collab-panel.css',
  'collab-publish.css',
  'collab-requests.css',
];

function readFeatureStyle(file: string): string {
  return readFileSync(path.resolve('src/style/features', file), 'utf8');
}

describe('Collab changed-file styles', () => {
  it('uses one shared class vocabulary for list and flat surfaces', () => {
    const publishCss = readFeatureStyle('collab-publish.css');
    const requestsCss = readFeatureStyle('collab-requests.css');

    expect(publishCss).toContain('.grandemonium-collab-file-list');
    expect(publishCss).toContain('.grandemonium-collab-file-list--list');
    expect(publishCss).toContain('.grandemonium-collab-file-list--flat');
    expect(publishCss).toContain('button.grandemonium-collab-file-button');
    expect(publishCss).toContain('.grandemonium-collab-file-kind[data-kind="added"]');
    expect(publishCss).toContain('.grandemonium-collab-file-kind[data-kind="deleted"]');
    expect(publishCss).toContain('.grandemonium-collab-file-path');
    expect(publishCss).toMatch(
      /button\.grandemonium-collab-file-button:is\(:hover, :focus-visible\)\s*\{[^}]*background:\s*var\(--background-modifier-hover\)/,
    );

    const changedFileCss = publishCss + requestsCss;
    expect(changedFileCss).not.toContain('grandemonium-collab-publish-files');
    expect(changedFileCss).not.toContain('grandemonium-collab-publish-file-');
    expect(changedFileCss).not.toContain('grandemonium-collab-team-request-files');
    expect(changedFileCss).not.toContain('grandemonium-collab-team-request-file');
  });

  it('removes only the verified static orphans and retains status modifiers', () => {
    const css = FEATURE_STYLES.map(readFeatureStyle).join('\n');

    for (const orphan of [
      'grandemonium-collab-access-invites',
      'grandemonium-collab-host-controls',
      'grandemonium-collab-invitation',
      'grandemonium-collab-project-details',
      'grandemonium-collab-publish-sync-action',
      'grandemonium-collab-publish-update',
      'grandemonium-collab-request-comments-empty',
    ]) {
      expect(css).not.toContain(orphan);
    }

    expect(css).toContain('.grandemonium-collab-publish-status--conflict');
    expect(css).toContain('.grandemonium-collab-publish-status--error');
    expect(css).toContain('.grandemonium-collab-publish-status--offline');
    expect(css).toContain('.grandemonium-collab-publish-status--awaiting-request');
    expect(css).toContain('.grandemonium-collab-publish-status--cancelled');
  });
});
