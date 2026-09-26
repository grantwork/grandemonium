import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';

export interface ConfirmActionOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

export function confirmAction(app: App, options: ConfirmActionOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const modal = new (class extends Modal {
      onOpen(): void {
        this.setTitle(options.title);
        this.contentEl.createEl('p', { text: options.message });
        new Setting(this.contentEl)
          .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
          .addButton((button) =>
            button
              .setButtonText(options.confirmLabel)
              .setDestructive()
              .onClick(() => {
                finish(true);
                this.close();
              })
          );
      }

      onClose(): void {
        this.contentEl.empty();
        finish(false);
      }
    })(app);
    modal.open();
  });
}
