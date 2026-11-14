import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';

export function interactiveReviewRequested(env = process.env) {
  const value = env.PASSPORT_MIDNAMES_INTERACTIVE;
  assert.ok(value === undefined || value === '0' || value === '1');
  return value === '1';
}

export function assertReviewTerminal() {
  assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Interactive review requires a terminal.');
}

/** @param {{ readonly amount: string | bigint }} intent @param {string} target */
export async function reviewInTerminal(intent, target) {
  assertReviewTerminal();
  const amount = String(intent.amount);
  const phrase = `SEND ${target} ${amount}`;
  console.log('Review the exact local Passport operation:');
  console.log(
    JSON.stringify(intent, (_key, value) => (typeof value === 'bigint' ? String(value) : value), 2),
  );
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (
      (await input.question(`Type ${phrase} to approve, or anything else to cancel: `)).trim() ===
      phrase
    );
  } finally {
    input.close();
  }
}
