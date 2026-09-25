import {
  DEFAULT_SETTINGS,
  MAX_POPOVER_SIZE,
  MIN_POPOVER_HEIGHT,
  MIN_POPOVER_WIDTH,
  normalizeVaultFolderPath,
  parseCommentsSettings,
  SETTINGS_VERSION,
  settingsEffects,
  validateExportNameTemplate,
  validateVaultFolderPath,
} from "@/features/comments/settings-model";

describe("settings model", () => {
  it("returns independent defaults for missing data", () => {
    const first = parseCommentsSettings(null).settings;
    const second = parseCommentsSettings(undefined).settings;

    expect(first).toEqual(DEFAULT_SETTINGS);
    expect(first).not.toBe(DEFAULT_SETTINGS);
    expect(first.authorColorOverrides).not.toBe(second.authorColorOverrides);
  });

  it("keeps valid values", () => {
    const result = parseCommentsSettings({
      ...DEFAULT_SETTINGS,
      highlightColor: "#AABBCC",
      highlightOpacity: 45,
      colorAuthorNames: false,
      showResolvedByDefault: true,
      resolveBehavior: "keep",
      sidebarSortOrder: "newest",
      submitShortcut: "mod-enter",
      timestampDisplay: "relative",
      confirmDestructiveActions: false,
      showReadingViewIndicator: false,
      schemaHint: false,
      copyIncludeQuote: false,
      exportNameTemplate: "{{date}} Review",
      exportScope: "open",
      exportDestination: "folder",
      exportFolder: "/Reviews/Team/",
      authorColorOverrides: { Leon: "#ABCDEF" },
    });

    expect(result.settings).toMatchObject({
      settingsVersion: SETTINGS_VERSION,
      highlightColor: "#aabbcc",
      highlightOpacity: 45,
      colorAuthorNames: false,
      showResolvedByDefault: true,
      resolveBehavior: "keep",
      sidebarSortOrder: "newest",
      submitShortcut: "mod-enter",
      timestampDisplay: "relative",
      confirmDestructiveActions: false,
      showReadingViewIndicator: false,
      schemaHint: false,
      copyIncludeQuote: false,
      exportNameTemplate: "{{date}} Review",
      exportScope: "open",
      exportDestination: "folder",
      exportFolder: "Reviews/Team",
      authorColorOverrides: { Leon: "#abcdef" },
    });
  });

  it("repairs invalid values and removes unknown keys", () => {
    const result = parseCommentsSettings({
      settingsVersion: 999,
      highlightColor: "red",
      highlightOpacity: "30",
      colorAuthorNames: "false",
      showResolvedByDefault: "true",
      resolveBehavior: "archive",
      sidebarSortOrder: "random",
      submitShortcut: "space",
      timestampDisplay: "sometimes",
      confirmDestructiveActions: 0,
      showReadingViewIndicator: "yes",
      schemaHint: null,
      copyIncludeQuote: [],
      exportNameTemplate: 42,
      exportScope: "resolved",
      exportDestination: "cloud",
      exportFolder: "../Outside",
      authorColorOverrides: { Leon: "bad" },
      unknownSetting: true,
    });

    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.changed).toBe(true);
    expect("unknownSetting" in result.settings).toBe(false);
  });

  it("clamps highlight opacity and migrates numeric author hues", () => {
    expect(parseCommentsSettings({ highlightOpacity: 2 }).settings.highlightOpacity).toBe(10);
    expect(parseCommentsSettings({ highlightOpacity: 100 }).settings.highlightOpacity).toBe(80);
    expect(parseCommentsSettings({ authorColorOverrides: { Leon: 210 } }).settings.authorColorOverrides.Leon)
      .toMatch(/^#[0-9a-f]{6}$/);
  });

  it("captures and removes the legacy synced author name", () => {
    const result = parseCommentsSettings({ authorName: "  Leon  " });

    expect(result.legacyAuthorName).toBe("Leon");
    expect("authorName" in result.settings).toBe(false);
  });

  it("disables resolved visibility when resolved threads are not kept", () => {
    const result = parseCommentsSettings({
      resolveBehavior: "remove",
      showResolvedByDefault: true,
    });

    expect(result.settings.showResolvedByDefault).toBe(false);
  });

  it("removes a duplicated Markdown extension from stored export templates", () => {
    expect(parseCommentsSettings({ exportNameTemplate: "Review.md" }).settings.exportNameTemplate)
      .toBe("Review");
  });

  it("validates export note templates", () => {
    expect(validateExportNameTemplate(" ")).toBe("Enter an export note name.");
    expect(validateExportNameTemplate("Review.md")).toContain("Leave off the .md extension");
    expect(validateExportNameTemplate("{{filename}} – Review")).toBeNull();
  });

  it("normalizes and validates vault folder paths", () => {
    expect(normalizeVaultFolderPath(" /Reviews//Team/ ")).toBe("Reviews/Team");
    expect(validateVaultFolderPath("Reviews/Team")).toBeNull();
    expect(validateVaultFolderPath("../Outside")).toBe("Choose a folder inside the vault.");
  });

  it("reports only the runtime effects required by a patch", () => {
    const highlight = { ...DEFAULT_SETTINGS, highlightOpacity: 50 };
    expect(settingsEffects(DEFAULT_SETTINGS, highlight)).toEqual({
      refreshHighlights: true,
      refreshAuthorColors: false,
      refreshSidebar: false,
      refreshReadingViewIndicator: false,
      resetResolvedVisibility: false,
    });

    const author = { ...DEFAULT_SETTINGS, authorColorOverrides: { Leon: "#112233" } };
    expect(settingsEffects(DEFAULT_SETTINGS, author).refreshAuthorColors).toBe(true);
    expect(
      settingsEffects(
        { ...DEFAULT_SETTINGS, authorColorOverrides: { Leon: "#112233" } },
        { ...DEFAULT_SETTINGS, authorColorOverrides: { Leon: "#112233" } }
      ).refreshAuthorColors
    ).toBe(false);

    const resolved = { ...DEFAULT_SETTINGS, showResolvedByDefault: true };
    expect(settingsEffects(DEFAULT_SETTINGS, resolved)).toMatchObject({
      refreshSidebar: true,
      resetResolvedVisibility: true,
    });

    const readingView = { ...DEFAULT_SETTINGS, showReadingViewIndicator: false };
    expect(settingsEffects(DEFAULT_SETTINGS, readingView).refreshReadingViewIndicator).toBe(true);
  });
});

describe("comment popover size", () => {
  function parseSize(width: unknown, height: unknown) {
    const { settings } = parseCommentsSettings({
      commentPopoverWidth: width,
      commentPopoverHeight: height,
    });
    return { width: settings.commentPopoverWidth, height: settings.commentPopoverHeight };
  }

  it("keeps a size the reader dragged out", () => {
    expect(parseSize(420, 300)).toEqual({ width: 420, height: 300 });
  });

  it("treats anything unset or nonsensical as never resized", () => {
    expect(parseSize(undefined, undefined)).toEqual({ width: 0, height: 0 });
    expect(parseSize(0, -40)).toEqual({ width: 0, height: 0 });
    expect(parseSize("wide", Number.NaN)).toEqual({ width: 0, height: 0 });
  });

  it("clamps a size that would leave the popover unreadable or off screen", () => {
    expect(parseSize(40, 20)).toEqual({
      width: MIN_POPOVER_WIDTH,
      height: MIN_POPOVER_HEIGHT,
    });
    expect(parseSize(9000, 9000)).toEqual({
      width: MAX_POPOVER_SIZE,
      height: MAX_POPOVER_SIZE,
    });
  });
});
