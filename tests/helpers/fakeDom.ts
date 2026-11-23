/**
 * Minimal DOM stand-in for UI tests under Node: what `h()` and the HUD and screen views touch
 * (elements, attributes, classes, text, `hidden`), with `.class` selectors for `querySelector`.
 * Listeners are accepted and never called.
 */
export class FakeNode {}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  className = '';
  id = '';
  hidden = false;
  readonly style = { transform: '', setProperty: (_name: string, _value: string) => {} };
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

  addEventListener(): void {}

  append(...nodes: (FakeElement | string)[]): void {
    this.childNodes.push(...nodes);
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

/** Installs the stand-ins as the global `document` and `Node`. */
export function installFakeDom(): void {
  dom.Node = FakeNode;
  dom.document = { createElement: (tag: string) => new FakeElement(tag) };
}

export function removeFakeDom(): void {
  delete dom.Node;
  delete dom.document;
}
