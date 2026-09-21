import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Persistent sidebar surface pager styles', () => {
  it('keeps the session surface bounded so its nested lists can scroll', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.grandemonium-session-surface(?:,\s*\.grandemonium-collab-surface)?\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/,
    );
  });

  it('keeps the sidebar footer visible without overlaying or clipping content', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.grandemonium-sidebar-surface-switcher\s*{[^}]*flex:\s*0 0 28px;/,
    );
    expect(css).toMatch(
      /\.grandemonium-session-sidebar \.grandemonium-sidebar-surface-button::before\s*{[^}]*width:\s*6px;[^}]*height:\s*6px;/,
    );
    expect(css).not.toMatch(
      /\.grandemonium-sidebar-surface-switcher\s*{[^}]*(?:position:\s*absolute|opacity:\s*0);/,
    );
    expect(css).not.toMatch(
      /\.grandemonium-session-sidebar:has\([^}]*clip-path:/,
    );
  });

  it('uses one geometry for waiting and error status badges', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.grandemonium-session-status-indicator\s*\{[^}]*display:\s*flex;[^}]*flex:\s*0 0 14px;[^}]*width:\s*14px;[^}]*height:\s*14px;/,
    );
    expect(css).toMatch(
      /\.grandemonium-session-status-indicator--action-required\s*\{[^}]*color:\s*var\(--color-orange\);/,
    );
    expect(css).toMatch(
      /\.grandemonium-session-status-indicator--error\s*\{[^}]*color:\s*var\(--text-error\);/,
    );
  });
});

describe('Single-pane history action styles', () => {
  it('keeps row actions borderless and transparent while using color for interaction', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.grandemonium-history-menu \.grandemonium-history-item-actions \.grandemonium-action-btn\s*{[^}]*background:\s*transparent;[^}]*border:\s*none;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--text-muted\);/,
    );
    expect(css).toMatch(
      /\.grandemonium-history-menu \.grandemonium-history-item-actions \.grandemonium-action-btn:hover,[\s\S]*?\.grandemonium-history-menu \.grandemonium-history-item-actions \.grandemonium-action-btn:focus-visible\s*{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--text-normal\);/,
    );
  });
});

describe('Session metadata popover styles', () => {
  it('scrolls a long Linked content title instead of clipping it to an ellipsis', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.grandemonium-session-metadata-value--content\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;[^}]*text-overflow:\s*clip;[^}]*scrollbar-width:\s*none;/,
    );
    expect(css).toMatch(
      /\.grandemonium-session-metadata-value--content::-webkit-scrollbar\s*\{[^}]*display:\s*none;/,
    );
  });

  it('keeps the Linked content override after the shared value rule so it still wins the cascade', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.grandemonium-session-metadata-value\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[\s\S]*?\.grandemonium-session-metadata-value--content\s*\{[^}]*overflow-x:\s*auto;/,
    );
  });
});
