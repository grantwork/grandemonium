interface Caret {
  key: string;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

/**
 * Text typed into the sidebar's boxes, kept across redraws. The sidebar is
 * rebuilt whenever any commented note is saved or any review starts or ends,
 * which elsewhere in the vault happens constantly, and a box rebuilt empty
 * throws away a reply the reader was halfway through typing or dictating.
 */
export class UnsentInputs {
  private readonly texts = new Map<string, string>();
  private bound = new Map<string, HTMLTextAreaElement>();
  /** The box dictation or an IME is still writing into, if any. */
  private composing: HTMLTextAreaElement | null = null;
  /** The latest redraw asked for while a composition was open. */
  private held: (() => void) | null = null;

  /** Registers a freshly built box, filling it with whatever was typed there before. */
  bind(key: string, input: HTMLTextAreaElement): void {
    const kept = this.texts.get(key);
    if (kept !== undefined) input.value = kept;
    this.bound.set(key, input);
    input.addEventListener("compositionstart", () => {
      this.composing = input;
    });
    input.addEventListener("compositionend", () => {
      if (this.composing !== input) return;
      this.composing = null;
      // Let the committed text land before the box it went into is replaced.
      if (this.held) window.setTimeout(() => this.runHeld(), 0);
    });
  }

  /**
   * Drops a box's text once it has been sent or cancelled. The box is let go
   * as well, because the redraw that follows would otherwise read the text
   * straight back out of it.
   */
  forget(key: string): void {
    this.texts.delete(key);
    this.bound.delete(key);
  }

  /**
   * Runs one redraw. Every bound box is read before `build` tears it down, and
   * the box that had focus gets it back, caret and all, so the reader carries
   * on typing into the new box as though it were the old one.
   */
  rebuild(build: () => void): void {
    // Replacing a box mid-composition ends the dictation, so every redraw
    // asked for meanwhile waits and only the latest one runs, once it is done.
    // A box removed some other way never reports its composition ending, and
    // must not leave the panel frozen.
    if (this.composing && !this.composing.isConnected) this.composing = null;
    if (this.composing) {
      this.held = build;
      return;
    }
    this.held = null;
    const caret = this.capture();
    build();
    if (caret) this.restore(caret);
  }

  private runHeld(): void {
    const build = this.held;
    if (build) this.rebuild(build);
  }

  private capture(): Caret | null {
    let caret: Caret | null = null;
    for (const [key, input] of this.bound) {
      // Kept even when empty: an edit box the reader cleared must not refill.
      this.texts.set(key, input.value);
      if (input.ownerDocument.activeElement === input) {
        caret = {
          key,
          start: input.selectionStart,
          end: input.selectionEnd,
          direction: input.selectionDirection ?? "none",
        };
      }
    }
    this.bound = new Map();
    return caret;
  }

  private restore(caret: Caret): void {
    const input = this.bound.get(caret.key);
    if (!input) return;
    // The redraw puts the panel back at its old scroll position; focusing must
    // not then jump it to wherever the box happens to sit.
    input.focus({ preventScroll: true });
    input.setSelectionRange(caret.start, caret.end, caret.direction);
  }
}
