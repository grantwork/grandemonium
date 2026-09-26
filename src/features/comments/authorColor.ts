/** Stable hue (0–359) derived from an author name, so each author keeps one color. */
export function authorHue(author: string): number {
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = (hash * 31 + author.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export type AuthorColorOverrides = Record<string, string>;
export type AuthorColorTheme = 'light' | 'dark';
export interface AuthorColorHsl {
  h: number;
  s: number;
  l: number;
}

export interface AuthorColorReadability {
  lightContrast: number;
  darkContrast: number;
  lowContrastThemes: AuthorColorTheme[];
}

const AUTHOR_COLOR_SATURATION = 55;
const AUTHOR_COLOR_LIGHTNESS: Record<AuthorColorTheme, number> = { light: 28, dark: 72 };
const STANDARD_THEME_BACKGROUNDS: Record<AuthorColorTheme, string> = {
  light: '#ffffff',
  dark: '#202020',
};
const MINIMUM_TEXT_CONTRAST = 4.5;

function normalizeHue(hue: number): number {
  return Math.round(((hue % 360) + 360) % 360) % 360;
}

export function authorColorHsl(hue: number, theme: AuthorColorTheme): AuthorColorHsl {
  return {
    h: normalizeHue(hue),
    s: AUTHOR_COLOR_SATURATION,
    l: AUTHOR_COLOR_LIGHTNESS[theme],
  };
}

export function authorColorCss(hue: number, theme: AuthorColorTheme): string {
  const color = authorColorHsl(hue, theme);
  return `hsl(${color.h} ${color.s}% ${color.l}%)`;
}

export function resolveAuthorColor(
  author: string,
  overrides: AuthorColorOverrides,
  theme: AuthorColorTheme
): string {
  const override = overrides[author];
  if (typeof override === 'string' && /^#[0-9a-f]{6}$/i.test(override)) return override;
  return authorColorCss(authorHue(author), theme);
}

export function hasAuthorColorOverride(overrides: AuthorColorOverrides, author: string): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, author);
}

export function normalizeAuthorColorOverrides(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [author, color] of Object.entries(value)) {
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) normalized[author] = color.toLowerCase();
  }
  return normalized;
}

function hexRgb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance(hex: string): number | null {
  const rgb = hexRgb(hex);
  if (!rgb) return null;
  const [red, green, blue] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function colorContrast(foreground: string, background: string): number | null {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return null;
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

export function authorColorReadability(color: string): AuthorColorReadability | null {
  const lightContrast = colorContrast(color, STANDARD_THEME_BACKGROUNDS.light);
  const darkContrast = colorContrast(color, STANDARD_THEME_BACKGROUNDS.dark);
  if (lightContrast === null || darkContrast === null) return null;
  const lowContrastThemes: AuthorColorTheme[] = [];
  if (lightContrast < MINIMUM_TEXT_CONTRAST) lowContrastThemes.push('light');
  if (darkContrast < MINIMUM_TEXT_CONTRAST) lowContrastThemes.push('dark');
  return { lightContrast, darkContrast, lowContrastThemes };
}

export function renameAuthorColorOverride(
  overrides: AuthorColorOverrides,
  previousAuthor: string,
  nextAuthor: string
): { ok: true; overrides: AuthorColorOverrides } | { ok: false; reason: 'duplicate' | 'empty' } {
  const trimmed = nextAuthor.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed !== previousAuthor && hasAuthorColorOverride(overrides, trimmed)) {
    return { ok: false, reason: 'duplicate' };
  }
  const renamed = { ...overrides, [trimmed]: overrides[previousAuthor] };
  delete renamed[previousAuthor];
  return { ok: true, overrides: renamed };
}
