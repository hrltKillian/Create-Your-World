/**
 * Minimal DOM stand-in for UI tests under Node: what `h()` and the HUD and screen views touch
 * (elements, attributes, classes, text, `hidden`, `disabled`, `remove()`, custom style properties),
 * with `.class` selectors for `querySelector`. Listeners are kept; `dispatch` calls them (a
 * stand-in for a click).
 */
export class FakeNode {}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  className = '';
  id = '';
  hidden = false;
  disabled = false;
  parent: FakeElement | null = null;
  private readonly properties = new Map<string, string>();
  readonly style = {
    transform: '',
    setProperty: (name: string, value: string) => {
      this.properties.set(name, value);
    },
    getPropertyValue: (name: string) => this.properties.get(name) ?? '',
  };
  readonly childNodes: (FakeElement | string)[] = [];
  private readonly attributes = new Map<string, string>();
  readonly classList = {
    add: (name: string) => this.setClass(name, true),
    remove: (name: string) => this.setClass(name, false),
    toggle: (name: string, force?: boolean) => this.setClass(name, force ?? !this.hasClass(name)),
    contains: (name: string) => this.hasClass(name),
  };

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }

  get textContent(): string {
    return this.childNodes.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }

  set textContent(text: string) {
    this.childNodes.length = 0;
    if (text !== '') this.childNodes.push(text);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** Calls the listeners of an event type. */
  dispatch(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) if (typeof node !== 'string') node.parent = this;
    this.childNodes.push(...nodes);
  }

  replaceChildren(...nodes: (FakeElement | string)[]): void {
    for (const node of this.childNodes) if (typeof node !== 'string') node.parent = null;
    this.childNodes.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    const siblings = this.parent?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  /** The first descendant whose `data-action` is `action` (menu buttons). */
  findAction(action: string): FakeElement | null {
    for (const child of this.childNodes) {
      if (typeof child === 'string') continue;
      if (child.getAttribute('data-action') === action) return child;
      const found = child.findAction(action);
      if (found) return found;
    }
    return null;
  }

  /** Every descendant element, depth first, that passes a test. */
  findAll(test: (element: FakeElement) => boolean): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.childNodes) {
      if (typeof child === 'string') continue;
      if (test(child)) found.push(child);
      found.push(...child.findAll(test));
    }
    return found;
  }

  /** The first descendant matching a `.class` selector. */
  querySelector(selector: string): FakeElement | null {
    for (const child of this.childNodes) {
      if (typeof child === 'string') continue;
      if (child.hasClass(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  private hasClass(name: string): boolean {
    return this.className.split(' ').includes(name);
  }

  private setClass(name: string, on: boolean): boolean {
    const names = this.className.split(' ').filter((n) => n !== '' && n !== name);
    if (on) names.push(name);
    this.className = names.join(' ');
    return on;
  }
}

const dom = globalThis as { document?: unknown; Node?: unknown };

/** Installs the stand-ins as the global `document` (always visible) and `Node`. */
export function installFakeDom(): void {
  dom.Node = FakeNode;
  dom.document = {
    createElement: (tag: string) => new FakeElement(tag),
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

export function removeFakeDom(): void {
  delete dom.Node;
  delete dom.document;
}
