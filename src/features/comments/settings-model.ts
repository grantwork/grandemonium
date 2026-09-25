import { type AuthorColorOverrides,normalizeAuthorColorOverrides } from "./author-color";

export const SETTINGS_VERSION = 1;

/** Sent to every enabled AI when the review action is triggered. */
export const DEFAULT_REVIEW_PROMPT =
  'review and reply to open comments where the user, not an LLM, was the last commenter';

/** Sent to one AI when asked to carry out what it proposed in a reply. */
export const DEFAULT_IMPLEMENT_PROMPT = 'Implement your suggested changes';

export type ResolveBehavior = "keep" | "remove";
export type ExportScope = "all" | "open";
export type ExportDestination = "source" | "folder";
export type SidebarSortOrder = "document" | "newest" | "oldest";
export type SubmitShortcut = "enter" | "mod-enter";
export type TimestampDisplay = "full" | "compact" | "relative" | "hidden";

export interface CommentsSettings {
  settingsVersion: number;
  highlightColor: string;
  highlightOpacity: number;
  colorAuthorNames: boolean;
  showResolvedByDefault: boolean;
  resolveBehavior: ResolveBehavior;
  sidebarSortOrder: SidebarSortOrder;
  submitShortcut: SubmitShortcut;
  timestampDisplay: TimestampDisplay;
  confirmDestructiveActions: boolean;
  commentOnSelection: boolean;
  commentPopover: boolean;
  commentPopoverHover: boolean;
  /** Card size in pixels, or 0 while the reader has never resized a popover. */
  commentPopoverWidth: number;
  commentPopoverHeight: number;
  reviewPrompt: string;
  implementPrompt: string;
  /**
   * Agent name every reply is addressed to, or "" for all enabled AIs. An
   * "@name" in the reply still overrides it for that one reply.
   */
  replyTarget: string;
  reviewOnComment: boolean;
  showReadingViewIndicator: boolean;
  schemaHint: boolean;
  copyIncludeQuote: boolean;
  exportNameTemplate: string;
  exportScope: ExportScope;
  exportDestination: ExportDestination;
  exportFolder: string;
  authorColorOverrides: AuthorColorOverrides;
}

export const DEFAULT_SETTINGS: CommentsSettings = {
  settingsVersion: SETTINGS_VERSION,
  highlightColor: "#ffd54a",
  highlightOpacity: 30,
  colorAuthorNames: true,
  showResolvedByDefault: false,
  resolveBehavior: "remove",
  sidebarSortOrder: "document",
  submitShortcut: "enter",
  timestampDisplay: "full",
  confirmDestructiveActions: true,
  commentOnSelection: true,
  commentPopover: true,
  commentPopoverHover: false,
  commentPopoverWidth: 0,
  commentPopoverHeight: 0,
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
  implementPrompt: DEFAULT_IMPLEMENT_PROMPT,
  replyTarget: "",
  reviewOnComment: true,
  showReadingViewIndicator: true,
  schemaHint: true,
  copyIncludeQuote: true,
  exportNameTemplate: "{{filename}} – Comments",
  exportScope: "all",
  exportDestination: "source",
  exportFolder: "",
  authorColorOverrides: {},
};

export interface ParsedCommentsSettings {
  settings: CommentsSettings;
  legacyAuthorName?: string;
  changed: boolean;
}

export interface SettingsEffects {
  refreshHighlights: boolean;
  refreshAuthorColors: boolean;
  refreshSidebar: boolean;
  refreshReadingViewIndicator: boolean;
  resetResolvedVisibility: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function enumSetting<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}

/** Sizes outside this range leave the popover unreadable or off screen. */
export const MIN_POPOVER_WIDTH = 220;
export const MIN_POPOVER_HEIGHT = 120;
export const MAX_POPOVER_SIZE = 720;

/** Zero means the reader has never resized a popover, so the CSS default wins. */
function popoverSizeSetting(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function opacitySetting(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.highlightOpacity;
  return Math.min(80, Math.max(10, Math.round(value)));
}

export function normalizeVaultFolderPath(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

export function validateVaultFolderPath(value: string): string | null {
  const path = normalizeVaultFolderPath(value);
  if (path.split("/").some((part) => part === "." || part === "..")) {
    return "Choose a folder inside the vault.";
  }
  return null;
}

export function parseCommentsSettings(value: unknown): ParsedCommentsSettings {
  const raw = isRecord(value) ? value : {};
  const template = stringSetting(raw.exportNameTemplate, DEFAULT_SETTINGS.exportNameTemplate)
    .trim()
    .replace(/\.md$/i, "");
  const resolveBehavior = enumSetting(
    raw.resolveBehavior,
    ["keep", "remove"] as const,
    DEFAULT_SETTINGS.resolveBehavior
  );
  const settings: CommentsSettings = {
    settingsVersion: SETTINGS_VERSION,
    highlightColor:
      typeof raw.highlightColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.highlightColor)
        ? raw.highlightColor.toLowerCase()
        : DEFAULT_SETTINGS.highlightColor,
    highlightOpacity: opacitySetting(raw.highlightOpacity),
    colorAuthorNames: booleanSetting(raw.colorAuthorNames, DEFAULT_SETTINGS.colorAuthorNames),
    showResolvedByDefault:
      resolveBehavior === "keep" &&
      booleanSetting(raw.showResolvedByDefault, DEFAULT_SETTINGS.showResolvedByDefault),
    resolveBehavior,
    sidebarSortOrder: enumSetting(
      raw.sidebarSortOrder,
      ["document", "newest", "oldest"] as const,
      DEFAULT_SETTINGS.sidebarSortOrder
    ),
    submitShortcut: enumSetting(
      raw.submitShortcut,
      ["enter", "mod-enter"] as const,
      DEFAULT_SETTINGS.submitShortcut
    ),
    timestampDisplay: enumSetting(
      raw.timestampDisplay,
      ["full", "compact", "relative", "hidden"] as const,
      DEFAULT_SETTINGS.timestampDisplay
    ),
    confirmDestructiveActions: booleanSetting(
      raw.confirmDestructiveActions,
      DEFAULT_SETTINGS.confirmDestructiveActions
    ),
    commentOnSelection: booleanSetting(raw.commentOnSelection, DEFAULT_SETTINGS.commentOnSelection),
    commentPopover: booleanSetting(raw.commentPopover, DEFAULT_SETTINGS.commentPopover),
    commentPopoverHover: booleanSetting(
      raw.commentPopoverHover,
      DEFAULT_SETTINGS.commentPopoverHover
    ),
    commentPopoverWidth: popoverSizeSetting(
      raw.commentPopoverWidth,
      MIN_POPOVER_WIDTH,
      MAX_POPOVER_SIZE
    ),
    commentPopoverHeight: popoverSizeSetting(
      raw.commentPopoverHeight,
      MIN_POPOVER_HEIGHT,
      MAX_POPOVER_SIZE
    ),
    reviewPrompt: stringSetting(raw.reviewPrompt, DEFAULT_SETTINGS.reviewPrompt).trim()
      || DEFAULT_REVIEW_PROMPT,
    replyTarget: stringSetting(raw.replyTarget, DEFAULT_SETTINGS.replyTarget).trim(),
    implementPrompt: stringSetting(raw.implementPrompt, DEFAULT_SETTINGS.implementPrompt).trim()
      || DEFAULT_IMPLEMENT_PROMPT,
    reviewOnComment: booleanSetting(raw.reviewOnComment, DEFAULT_SETTINGS.reviewOnComment),
    showReadingViewIndicator: booleanSetting(
      raw.showReadingViewIndicator,
      DEFAULT_SETTINGS.showReadingViewIndicator
    ),
    schemaHint: booleanSetting(raw.schemaHint, DEFAULT_SETTINGS.schemaHint),
    copyIncludeQuote: booleanSetting(raw.copyIncludeQuote, DEFAULT_SETTINGS.copyIncludeQuote),
    exportNameTemplate: template || DEFAULT_SETTINGS.exportNameTemplate,
    exportScope: enumSetting(raw.exportScope, ["all", "open"] as const, DEFAULT_SETTINGS.exportScope),
    exportDestination: enumSetting(
      raw.exportDestination,
      ["source", "folder"] as const,
      DEFAULT_SETTINGS.exportDestination
    ),
    exportFolder:
      validateVaultFolderPath(stringSetting(raw.exportFolder, DEFAULT_SETTINGS.exportFolder)) === null
        ? normalizeVaultFolderPath(raw.exportFolder)
        : DEFAULT_SETTINGS.exportFolder,
    authorColorOverrides: normalizeAuthorColorOverrides(raw.authorColorOverrides),
  };
  const legacyAuthorName = typeof raw.authorName === "string" ? raw.authorName.trim() : undefined;
  return {
    settings,
    legacyAuthorName: legacyAuthorName || undefined,
    changed: JSON.stringify(value ?? {}) !== JSON.stringify(settings),
  };
}

export function validateExportNameTemplate(value: string): string | null {
  if (!value.trim()) return "Enter an export note name.";
  if (/\.md\s*$/i.test(value)) return "Leave off the .md extension; Tandem Comments adds it automatically.";
  return null;
}

export function settingsEffects(previous: CommentsSettings, next: CommentsSettings): SettingsEffects {
  const resetResolvedVisibility = previous.showResolvedByDefault !== next.showResolvedByDefault;
  return {
    refreshHighlights:
      previous.highlightColor !== next.highlightColor ||
      previous.highlightOpacity !== next.highlightOpacity,
    refreshAuthorColors:
      previous.colorAuthorNames !== next.colorAuthorNames ||
      JSON.stringify(previous.authorColorOverrides) !== JSON.stringify(next.authorColorOverrides),
    refreshSidebar:
      resetResolvedVisibility ||
      previous.sidebarSortOrder !== next.sidebarSortOrder ||
      previous.timestampDisplay !== next.timestampDisplay,
    refreshReadingViewIndicator:
      previous.showReadingViewIndicator !== next.showReadingViewIndicator,
    resetResolvedVisibility,
  };
}
