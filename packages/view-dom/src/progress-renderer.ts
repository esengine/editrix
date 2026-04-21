import type { IDisposable } from '@editrix/common';
import type { IProgressService, ProgressEvent } from '@editrix/core';

const STYLE_ID = 'editrix-progress-styles';
const STACK_ID = 'editrix-progress-stack';
const END_FADE_MS = 250;

interface LiveCard {
  element: HTMLDivElement;
  messageEl: HTMLElement;
  fillEl: HTMLElement;
  fadeTimer: ReturnType<typeof setTimeout> | undefined;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PROGRESS_CSS;
  document.head.appendChild(style);
}

function ensureStack(): HTMLDivElement {
  const existing = document.getElementById(STACK_ID);
  if (existing) return existing as HTMLDivElement;
  const stack = document.createElement('div');
  stack.id = STACK_ID;
  stack.className = 'editrix-progress-stack';
  document.body.appendChild(stack);
  return stack;
}

/**
 * Renders a stack of progress cards bound to an {@link IProgressService}.
 * Pure observer — the service owns lifecycle + cancellation; this class
 * only reacts to `onDidChange` and paints DOM.
 */
export class DomProgressRenderer implements IDisposable {
  private readonly _cards = new Map<number, LiveCard>();
  private readonly _subscription: IDisposable;

  constructor(private readonly _service: IProgressService) {
    injectStyles();
    this._subscription = _service.onDidChange((event) => {
      this._onEvent(event);
    });
    // Replay tasks that were running before we subscribed.
    for (const active of _service.getActive()) {
      this._startCard(active);
    }
  }

  dispose(): void {
    this._subscription.dispose();
    for (const card of this._cards.values()) {
      if (card.fadeTimer) clearTimeout(card.fadeTimer);
      card.element.remove();
    }
    this._cards.clear();
    const stack = document.getElementById(STACK_ID);
    if (stack?.childElementCount === 0) stack.remove();
  }

  private _onEvent(event: ProgressEvent): void {
    if (event.kind === 'start') {
      this._startCard(event);
      return;
    }
    const card = this._cards.get(event.id);
    if (!card) return;
    if (event.kind === 'update') {
      if (event.message !== undefined) card.messageEl.textContent = event.message;
      card.fillEl.style.width = `${String(event.percent)}%`;
      return;
    }
    // 'end'
    card.element.classList.add('editrix-progress--ending');
    card.fadeTimer = setTimeout(() => {
      card.element.remove();
      this._cards.delete(event.id);
      const stack = document.getElementById(STACK_ID);
      if (stack?.childElementCount === 0) stack.remove();
    }, END_FADE_MS);
  }

  private _startCard(event: ProgressEvent): void {
    if (this._cards.has(event.id)) return;
    const stack = ensureStack();

    const card = document.createElement('div');
    card.className = 'editrix-progress';

    const header = document.createElement('div');
    header.className = 'editrix-progress__header';
    const title = document.createElement('div');
    title.className = 'editrix-progress__title';
    title.textContent = event.title;
    header.appendChild(title);
    if (event.cancellable) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'editrix-progress__cancel';
      cancelBtn.textContent = '\u00D7';
      cancelBtn.title = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        this._service.cancel(event.id);
      });
      header.appendChild(cancelBtn);
    }
    card.appendChild(header);

    const messageEl = document.createElement('div');
    messageEl.className = 'editrix-progress__message';
    messageEl.textContent = event.message ?? '';
    card.appendChild(messageEl);

    const barBox = document.createElement('div');
    barBox.className = 'editrix-progress__bar';
    const fillEl = document.createElement('div');
    fillEl.className = 'editrix-progress__fill';
    fillEl.style.width = `${String(event.percent)}%`;
    barBox.appendChild(fillEl);
    card.appendChild(barBox);

    stack.appendChild(card);
    this._cards.set(event.id, { element: card, messageEl, fillEl, fadeTimer: undefined });
  }
}

const PROGRESS_CSS = `
.editrix-progress-stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  z-index: 9000;
}
.editrix-progress {
  pointer-events: auto;
  min-width: 220px;
  max-width: 320px;
  padding: 8px 10px;
  background: rgba(30, 30, 34, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: var(--editrix-text);
  font-size: 12px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: opacity ${String(END_FADE_MS)}ms ease-out;
}
.editrix-progress--ending { opacity: 0; }
.editrix-progress__header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.editrix-progress__title {
  flex: 1;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editrix-progress__cancel {
  width: 18px; height: 18px;
  background: transparent;
  color: var(--editrix-text-dim);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.editrix-progress__cancel:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--editrix-text);
}
.editrix-progress__message {
  color: var(--editrix-text-dim);
  font-size: 11px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-height: 14px;
}
.editrix-progress__bar {
  margin-top: 6px;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}
.editrix-progress__fill {
  height: 100%;
  background: var(--editrix-accent, #4a8fff);
  transition: width 120ms ease-out;
}
`;
