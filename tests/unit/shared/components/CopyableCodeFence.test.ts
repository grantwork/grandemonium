import { createMockEl } from '@test/helpers/MockElement';

import { enhanceRenderedCodeFence } from '@/shared/components/CopyableCodeFence';

describe('CopyableCodeFence', () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: (tag: string) => createMockEl(tag),
      },
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  });

  it('adopts a Markdown-rendered fence without duplicating its wrapper', () => {
    const container = createMockEl();
    const pre = container.createEl('pre');
    Object.defineProperty(pre, 'parentElement', {
      configurable: true,
      value: container,
    });
    const code = pre.createEl('code', { text: 'const ready = true;' });
    code.className = 'language-typescript';
    const copyButton = pre.createEl('button', { cls: 'copy-code-button' });
    const querySelector = pre.querySelector.bind(pre);
    pre.querySelector = (selector: string) => (
      selector.startsWith('code[') ? code : querySelector(selector)
    );

    const wrapper = enhanceRenderedCodeFence(pre);
    Object.defineProperty(pre, 'parentElement', {
      configurable: true,
      value: wrapper,
    });
    const repeated = enhanceRenderedCodeFence(pre);

    expect(repeated).toBe(wrapper);
    expect((wrapper as any).hasClass('grandemonium-code-wrapper')).toBe(true);
    expect((wrapper as any).hasClass('has-language')).toBe(true);
    expect((wrapper as any).querySelector('.grandemonium-code-lang-label')?.textContent)
      .toBe('typescript');
    expect((wrapper as any).children).toContain(copyButton);
    expect(container.querySelectorAll('.grandemonium-code-wrapper')).toHaveLength(1);
  });
});
