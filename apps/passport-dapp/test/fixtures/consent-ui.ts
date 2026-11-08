import assert from 'node:assert/strict';
import { finishDemoConsent } from '../../src/consent.ts';

export class Control extends EventTarget {
  hidden = false;
  checked = false;
  disabled = false;
  open = false;
  textContent = '';
  returnValue = '';
  dataset: Record<string, string> = {};
  shows = 0;
  focus() {}
  showModal() {
    this.open = true;
    this.shows++;
  }
  close(value: string) {
    this.open = false;
    this.returnValue = value;
    this.dispatchEvent(new Event('close'));
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 10 };
  }
  getClientRects() {
    return [this.getBoundingClientRect()];
  }
  click() {
    this.dispatchEvent(new Event('click'));
  }
}

export async function withUi(
  work: (controls: Map<string, Control>, frame: (() => void)[]) => Promise<void>,
) {
  const names = ['document', 'requestAnimationFrame', 'innerHeight', 'getComputedStyle'] as const;
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const controls = new Map(
    [
      'ceremony-dialog',
      'ceremony-continue',
      'ceremony-cancel',
      'ceremony-purpose',
      'ceremony-title',
      'ceremony-details',
      'consent-retirement',
      'consent-retirement-ack',
    ].map((id) => [id, new Control()]),
  );
  const frame: (() => void)[] = [];
  Object.assign(globalThis, {
    document: Object.assign(new EventTarget(), {
      getElementById: (id: string) => controls.get(id),
      querySelector: () =>
        controls.get('ceremony-dialog')?.open ? controls.get('ceremony-dialog') : null,
    }),
    requestAnimationFrame: (callback: () => void) => {
      frame.push(callback);
      return frame.length;
    },
    innerHeight: 900,
    getComputedStyle: () => ({ visibility: 'visible' }),
  });
  try {
    await work(controls, frame);
  } finally {
    finishDemoConsent();
    names.forEach((name, i) => {
      const descriptor = previous[i];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}
export const control = (controls: Map<string, Control>, id: string) => {
  const value = controls.get(id);
  assert.ok(value, id);
  return value;
};
export async function approve(
  controls: Map<string, Control>,
  frame: (() => void)[],
  betweenFrames?: () => void,
) {
  control(controls, 'ceremony-continue').click();
  for (let i = 0; i < 5 && frame.length === 0; i++) await Promise.resolve();
  assert.equal(frame.length, 1);
  frame.shift()?.();
  betweenFrames?.();
  frame.shift()?.();
}
