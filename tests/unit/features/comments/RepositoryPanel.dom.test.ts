/** @jest-environment jsdom */

import { fireEvent, screen, within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { MarkdownRenderer } from 'obsidian';

import type { RepositoryTurnCallbacks, RepositoryTurnResult } from '@/core/auxiliary/RepositoryThreadSession';
import type { ProviderInteractionPort } from '@/core/execution';
import { RepositoryPanel } from '@/features/comments/RepositoryPanel';
import {
  type RepositoryAgentPort,
  RepositoryThreadsController,
} from '@/features/comments/RepositoryThreadsController';

HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };
HTMLElement.prototype.toggleClass = function (classes, value) {
  for (const cls of Array.isArray(classes) ? classes : [classes]) this.classList.toggle(cls, value);
};
HTMLElement.prototype.empty = function () { this.replaceChildren(); };

interface Sent {
  prompt: string;
  callbacks: RepositoryTurnCallbacks;
  port: ProviderInteractionPort;
  finish(result: RepositoryTurnResult): void;
}

function setup() {
  const sent: Sent[] = [];
  const disposed: string[] = [];
  const port: RepositoryAgentPort = {
    agents: () => [{ name: 'gpt', providerId: 'codex' }],
    defaultSelection: () => ({ model: 'gpt-6', providerId: 'codex' }),
    generateTitle: async () => null,
    mountToolbar: (parent) => {
      parent.createDiv({ cls: 'fake-toolbar', text: 'GPT-6' });
      return { destroy: () => undefined, refresh: () => undefined, setUsage: () => undefined };
    },
    openSession: (providerId, interactionPort) => {
      let busy = false;
      return {
        dispose: async () => {
          disposed.push(providerId);
        },
        isFresh: () => true,
        isRunning: () => busy,
        send: (prompt, _model, callbacks) => {
          busy = true;
          let finish!: (result: RepositoryTurnResult) => void;
          const done = new Promise<RepositoryTurnResult>((resolve) => {
            finish = (result) => {
              busy = false;
              resolve(result);
            };
          });
          sent.push({ callbacks, finish, port: interactionPort, prompt });
          return { cancel: () => finish({ kind: 'cancelled', text: '' }), done };
        },
      };
    },
  };
  const controller = new RepositoryThreadsController({
    agents: () => port,
    author: () => 'grant',
    notify: () => undefined,
    now: () => '2026-09-23T01:00:00.000Z',
    preferredAgentName: () => '',
    resolveBehavior: () => 'keep',
    storage: { read: async () => undefined, write: async () => undefined },
  });
  const panel = new RepositoryPanel({
    app: {} as never,
    component: {} as never,
    confirmDestructive: () => false,
    controller,
    formatTimestamp: () => null,
    isAgentAuthor: (author) => author === 'gpt',
    paintAuthor: () => undefined,
    showResolved: () => false,
    submitShortcut: () => 'enter',
  });
  document.body.appendChild(panel.el);
  return { controller, disposed, panel, sent };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
});

function startThread(text: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'New repository comment' }));
  const box = screen.getByRole('textbox', { name: /Ask an AI to make changes/ });
  fireEvent.input(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

it('opens a composer with the chat toolbar and starts a thread from it', () => {
  const { sent } = setup();

  startThread('Add a persona group and update the privacy policy');

  expect(sent).toHaveLength(1);
  expect(sent[0].prompt).toContain('Add a persona group and update the privacy policy');
  expect(
    screen.getByRole('button', { name: /^Add a persona group and update the privacy policy/ })
      .getAttribute('aria-expanded')
  ).toBe('true');
  expect(screen.getAllByText('GPT-6').length).toBeGreaterThan(0);
});

it("streams the agent's reply into the thread and posts it when finished", async () => {
  const { sent } = setup();
  startThread('Go');

  sent[0].callbacks.onActivity('Edit Personas.md');
  sent[0].callbacks.onText('Updating the personas');
  expect(screen.getByText('Edit Personas.md')).toBeTruthy();
  expect(screen.getByText('Updating the personas')).toBeTruthy();

  sent[0].finish({ kind: 'completed', text: 'Updated 4 files.' });
  await flush();

  expect(screen.queryByText('Edit Personas.md')).toBeNull();
  expect(screen.getByRole('textbox', { name: /Reply/ })).toBeTruthy();
});

it('shows the AI replying until its first words arrive', () => {
  const { sent } = setup();
  startThread('Go');

  expect(screen.getByRole('status', { name: 'gpt is replying' })).toBeTruthy();

  sent[0].callbacks.onText('Updating');

  expect(screen.queryByRole('status', { name: 'gpt is replying' })).toBeNull();
  expect(screen.getByText('Updating')).toBeTruthy();
});

it("marks an AI's error in the thread with an alert", async () => {
  const { sent } = setup();
  startThread('Go');

  sent[0].finish({ kind: 'failed', message: 'process exited', text: '' });
  await flush();

  const error = screen.getByText("Couldn't finish: process exited").closest<HTMLElement>('.grandemonium-comment-entry')!;
  expect(within(error).getByRole('img', { name: 'Error' })).toBeTruthy();
  expect(within(error).getByText('gpt')).toBeTruthy();
});

it("asks for approval inside the thread and answers with the reader's choice", async () => {
  const { sent } = setup();
  startThread('Go');

  const response = sent[0].port.requestApproval(
    {
      description: 'Write Privacy.md',
      input: {},
      interactionId: 'i-1',
      kind: 'approval',
      sessionInstanceId: 's',
      toolName: 'Write',
      turnId: 't',
    },
    new AbortController().signal
  );
  const approval = screen.getByRole('group', { name: 'Permission required' });
  expect(await axe(approval)).toHaveNoViolations();

  fireEvent.click(within(approval).getByRole('button', { name: 'Allow' }));

  await expect(response).resolves.toEqual({ decision: 'allow', interactionId: 'i-1' });
  expect(screen.queryByRole('group', { name: 'Permission required' })).toBeNull();
});

it('ends the AI session when the thread is resolved', async () => {
  const { controller, disposed } = setup();
  startThread('Go');
  const [thread] = controller.list();

  fireEvent.click(screen.getByRole('button', { name: 'Resolve and end the AI session' }));
  await flush();

  expect(disposed).toEqual(['codex']);
  expect(controller.get(thread.id)?.status).toBe('resolved');
  expect(screen.queryByRole('button', { name: /^Go/ })).toBeNull();
});

/** Three rounds between the reader and gpt, so the middle four entries fold. */
async function buildLongThread(): Promise<void> {
  jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
    (el as HTMLElement).textContent = markdown;
  });
  const { sent } = setup();
  startThread('First ask');
  sent[0].finish({ kind: 'completed', text: 'Answer one' });
  await flush();
  for (const [index, text] of ['Second ask', 'Third ask'].entries()) {
    const reply = screen.getByRole('textbox', { name: /Reply/ });
    fireEvent.input(reply, { target: { value: text } });
    fireEvent.keyDown(reply, { key: 'Enter' });
    await flush();
    sent[index + 1].finish({ kind: 'completed', text: index === 0 ? 'Answer two' : 'Answer three' });
    await flush();
  }
}

it('folds the middle of a long thread to one line per entry and opens one on request', async () => {
  await buildLongThread();

  const folded = screen.getAllByRole('button', { name: /^Show comment by / });
  expect(folded.map((button) => button.textContent)).toEqual([
    expect.stringContaining('Answer one'),
    expect.stringContaining('Second ask'),
    expect.stringContaining('Answer two'),
  ]);
  expect(screen.getByText('First ask', { selector: '.grandemonium-comment-text' })).toBeTruthy();
  expect(screen.getByText('Third ask', { selector: '.grandemonium-comment-text' })).toBeTruthy();
  expect(screen.getByText('Answer three', { selector: '.grandemonium-comment-text' })).toBeTruthy();

  fireEvent.click(folded[1]);

  expect(screen.getByText('Second ask', { selector: '.grandemonium-comment-text' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Show comment by / })).toHaveLength(2);
  jest.mocked(MarkdownRenderer.render).mockRestore();
});

it('folds an opened entry back when its author and time are pressed, and opens it again', async () => {
  await buildLongThread();
  fireEvent.click(screen.getByRole('button', { name: 'Show comment by grant' }));

  const heading = screen.getByRole('button', { name: 'Hide comment by grant' });
  expect(heading.getAttribute('aria-expanded')).toBe('true');
  expect(heading.textContent).toContain('grant');
  expect(await axe(heading.closest('.grandemonium-comment-entry') as HTMLElement)).toHaveNoViolations();
  fireEvent.click(heading);

  expect(screen.queryByText('Second ask', { selector: '.grandemonium-comment-text' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Hide comment by / })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show comment by grant' }));
  expect(screen.getByText('Second ask', { selector: '.grandemonium-comment-text' })).toBeTruthy();
  jest.mocked(MarkdownRenderer.render).mockRestore();
});
