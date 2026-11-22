/** Tiny DOM builder. Text children must come from `t()` (checked by the architecture test). */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  readonly class?: string;
  readonly id?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly on?: {
    readonly [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
  };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props?.class) el.className = props.class;
  if (props?.id) el.id = props.id;
  if (props?.attrs)
    for (const [name, value] of Object.entries(props.attrs)) el.setAttribute(name, value);
  if (props?.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      if (handler) el.addEventListener(name, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}
