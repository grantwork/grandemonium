const WELCOME_BRAND_NAME = 'Grandemonium';

export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
): void {
  welcomeEl.empty();
  welcomeEl.createDiv({
    cls: 'grandemonium-welcome-brand grandemonium-welcome-text',
    text: WELCOME_BRAND_NAME,
  });

  if (greeting) {
    welcomeEl.createDiv({
      cls: 'grandemonium-welcome-greeting grandemonium-welcome-text',
      text: greeting,
    });
  }

  welcomeEl.createDiv({ cls: 'grandemonium-welcome-linked-content' });
}

export function createWelcomeElement(
  parentEl: HTMLElement,
  greeting?: string,
): HTMLElement {
  const welcomeEl = parentEl.createDiv({ cls: 'grandemonium-welcome' });
  renderWelcomeContent(welcomeEl, greeting);
  return welcomeEl;
}
