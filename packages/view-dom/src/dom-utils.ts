/**
 * Create a DOM element with optional class names and attributes.
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

/**
 * Remove all child nodes from an element.
 */
export function clearChildren(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * Set CSS custom properties on an element.
 */
export function setCssVars(el: HTMLElement, vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value);
  }
}
