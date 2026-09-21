import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Grok brand color', () => {
  const variablesCss = fs.readFileSync(
    path.join(process.cwd(), 'src/style/base/variables.css'),
    'utf8',
  );
  it('uses white in dark mode and black in light mode', () => {
    expect(variablesCss).toContain('--grandemonium-brand-grok: #ffffff;');
    expect(variablesCss).toContain('--grandemonium-brand-grok-rgb: 255, 255, 255;');
    expect(variablesCss).toMatch(
      /body\.theme-light \.grandemonium-container \{[\s\S]*?--grandemonium-brand-grok: #000000;[\s\S]*?--grandemonium-brand-grok-rgb: 0, 0, 0;[\s\S]*?\}/,
    );
  });

  it('routes active Grok surfaces through its brand token', () => {
    expect(variablesCss).toMatch(
      /\.grandemonium-container\[data-provider="grok"\] \{[\s\S]*?--grandemonium-brand: var\(--grandemonium-brand-grok\);[\s\S]*?--grandemonium-brand-rgb: var\(--grandemonium-brand-grok-rgb\);[\s\S]*?\}/,
    );
  });
});
