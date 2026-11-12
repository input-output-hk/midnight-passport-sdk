import assert from 'node:assert/strict';
import { createAgentGrantSpendJournal } from '../../packages/account/dist/index.js';
import { fileMutationByteStore } from '../../packages/service/dist/index.js';

const [directory, input, transaction] = process.argv.slice(2);
assert.ok(directory && input && transaction);
const receipts = createAgentGrantSpendJournal(fileMutationByteStore(directory));
const original = JSON.parse(input);
assert.equal(await receipts.reserve(original), true);
assert.equal(await receipts.stageTransaction(original, JSON.parse(transaction)), true);
process.kill(process.pid, 'SIGKILL');
