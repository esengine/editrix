import type { ListItem } from '@editrix/view-dom';
import { BaseWidget, ListWidget, Toolbar } from '@editrix/view-dom';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: Date;
  readonly source?: string;
}

const LEVEL_PREFIXES: Record<LogLevel, string> = {
  info: 'I',
  warn: 'W',
  error: 'E',
  debug: 'D',
};

const LEVEL_CLASSES: Record<LogLevel, string> = {
  info: 'editrix-console-info',
  warn: 'editrix-console-warn',
  error: 'editrix-console-error',
  debug: 'editrix-console-debug',
};

/**
 * Console panel widget.
 *
 * @example
 * ```ts
 * const widget = new ConsoleWidget('console');
 * widget.log('info', 'Editor started');
 * ```
 */
export class ConsoleWidget extends BaseWidget {
  private _list: ListWidget | undefined;
  private _toolbar: Toolbar | undefined;
  private _entryId = 0;
  private _showLevel: LogLevel | 'all' = 'all';

  constructor(id: string) {
    super(id, 'console');
  }

  log(level: LogLevel, message: string, source?: string): void {
    if (!this._list) return;

    this._entryId++;
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    const detail = source ? `[${source}] ${time}` : time;

    const item: ListItem = {
      id: String(this._entryId),
      text: message,
      detail,
      icon: LEVEL_PREFIXES[level],
      className: LEVEL_CLASSES[level],
    };

    this._list.addItem(item);
  }

  clear(): void {
    this._list?.clear();
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    const toolbarEl = this.appendElement(root, 'div');
    this._toolbar = new Toolbar(toolbarEl);
    this.subscriptions.add(this._toolbar);

    this.subscriptions.add(
      this._toolbar.addAction({
        id: 'clear',
        label: 'Clear',
        icon: 'trash',
        tooltip: 'Clear all log entries',
        onClick: () => { this.clear(); },
      }),
    );

    const levels: LogLevel[] = ['info', 'warn', 'error', 'debug'];
    for (const level of levels) {
      this.subscriptions.add(
        this._toolbar.addAction({
          id: `filter-${level}`,
          label: level.toUpperCase(),
          tooltip: `Filter ${level} messages`,
          onClick: () => { this._toggleFilter(level); },
        }),
      );
    }

    const listContainer = this.appendElement(root, 'div');
    listContainer.style.flex = '1';
    listContainer.style.overflow = 'hidden';
    listContainer.style.display = 'flex';

    this._list = new ListWidget(`${this.id}-list`, {
      showFilter: true,
      placeholder: 'No log entries',
      autoScroll: true,
    });
    this.subscriptions.add(this._list);
    this._list.mount(listContainer);
  }

  private _toggleFilter(level: LogLevel): void {
    if (this._showLevel === level) {
      this._showLevel = 'all';
      this._toolbar?.setToggled(`filter-${level}`, false);
      this._list?.setExternalFilter(undefined);
    } else {
      if (this._showLevel !== 'all') {
        this._toolbar?.setToggled(`filter-${this._showLevel}`, false);
      }
      this._showLevel = level;
      this._toolbar?.setToggled(`filter-${level}`, true);
      const targetClass = LEVEL_CLASSES[level];
      this._list?.setExternalFilter((item) => item.className === targetClass);
    }
  }

  private _injectStyles(): void {
    if (document.getElementById('editrix-console-styles')) return;

    const style = document.createElement('style');
    style.id = 'editrix-console-styles';
    style.textContent = `
      .editrix-widget-console .editrix-list-item {
        font-family: var(--editrix-mono-font, Consolas, monospace);
      }
      .editrix-console-info .editrix-list-item-icon { color: #3794ff; }
      .editrix-console-warn .editrix-list-item-icon { color: #cca700; }
      .editrix-console-warn .editrix-list-item-text { color: #cca700; }
      .editrix-console-error .editrix-list-item-icon { color: #f14c4c; }
      .editrix-console-error .editrix-list-item-text { color: #f14c4c; }
      .editrix-console-debug .editrix-list-item-icon { color: #858585; }
      .editrix-console-debug .editrix-list-item-text { color: #858585; }
    `;
    document.head.appendChild(style);
  }
}
