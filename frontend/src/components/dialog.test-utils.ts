import { fireEvent } from '@testing-library/react';

// jsdom has no modal top layer. Browser verification covers native showModal,
// inert background behavior, and native button keyboard activation.
export function mockDialogMethods() {
  const prototype = HTMLDialogElement.prototype;
  const previousShow = Object.getOwnPropertyDescriptor(prototype, 'showModal');
  const previousClose = Object.getOwnPropertyDescriptor(prototype, 'close');
  Object.defineProperty(prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  return () => {
    if (previousShow) Object.defineProperty(prototype, 'showModal', previousShow);
    else Reflect.deleteProperty(prototype, 'showModal');
    if (previousClose) Object.defineProperty(prototype, 'close', previousClose);
    else Reflect.deleteProperty(prototype, 'close');
  };
}

export function activateButtonByKey(button: HTMLElement, key: 'Enter' | ' ') {
  button.focus();
  // Supply the default activation jsdom omits; do not bypass cancelled keys.
  const allowed = fireEvent.keyDown(button, { key });
  if (allowed && key === 'Enter') fireEvent.click(button);
  fireEvent.keyUp(button, { key });
  if (allowed && key === ' ') fireEvent.click(button);
}
