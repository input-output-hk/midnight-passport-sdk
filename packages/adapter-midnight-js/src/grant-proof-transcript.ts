import {
  CostModel,
  Proof,
  type AlignedValue,
  type Op,
  type Transcript,
  type UnprovenTransaction,
} from '@midnightntwrk/ledger-v9';
import { singleContractCall } from './single-contract-call.js';

type Program = readonly Op<AlignedValue>[];
type Check = (bigint | undefined)[];

const noop = (op: Program[number] | undefined) =>
  typeof op === 'object' && 'noop' in op ? op.noop.n : undefined;

function readGap(program: Program, index: number) {
  const start = index;
  let count = 0;
  while (index < program.length) {
    const skip = noop(program[index]);
    if (skip === undefined) break;
    count += skip;
    index++;
  }
  return { index, ops: index - start, count };
}

/** Ledger 9 inserts noops at transcript gaps, then coalesces them and meters their cost. */
function appendCheck(
  before: Transcript<AlignedValue> | undefined,
  after: Transcript<AlignedValue> | undefined,
  check: Check,
): boolean {
  if (!before || !after) return before === after;
  let original = 0;
  let proved = 0;
  for (;;) {
    const left = readGap(before.program, original);
    const right = readGap(after.program, proved);
    if (right.count < left.count || right.count > 0xffffffff) return false;
    if (right.count > left.count) check.push(BigInt(right.count - left.count));
    for (let index = 0; index < left.ops; index++) check.push(undefined);
    original = left.index;
    proved = right.index;
    if (original === before.program.length || proved === after.program.length)
      return original === before.program.length && proved === after.program.length;
    check.push(undefined);
    original++;
    proved++;
  }
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/**
 * Replay only the pinned ledger's transcript transformation with a placeholder proof.
 * Compare the entire proof-erased transaction. The returned proof itself is validated
 * by the ledger on submission, and never replaced by the placeholder.
 */
export async function matchesGrantProofTranscript(
  original: UnprovenTransaction,
  returned: ReturnType<typeof singleContractCall>,
  erased: Uint8Array,
  address: string,
  circuit: string,
  verifierKey: () => Promise<Uint8Array>,
): Promise<boolean> {
  const initial = singleContractCall(original, address, circuit);
  if (
    !initial ||
    !returned ||
    returned.segment !== initial.segment ||
    returned.call.communicationCommitment !== initial.call.communicationCommitment
  )
    return false;
  const check: Check = [];
  if (
    !appendCheck(initial.call.guaranteedTranscript, returned.call.guaranteedTranscript, check) ||
    !appendCheck(initial.call.fallibleTranscript, returned.call.fallibleTranscript, check) ||
    !check.some((step) => step !== undefined)
  )
    return false;
  const expected = await original.prove(
    {
      check: async () => check,
      prove: async () => new Proof('0100').serialize(),
      lookupKey: async () => ({
        verifierKey: await verifierKey(),
        proverKey: new Uint8Array(),
        ir: new Uint8Array(),
      }),
    },
    CostModel.initialCostModel(),
  );
  return sameBytes(erased, expected.eraseProofs().serialize());
}
