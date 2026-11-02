import { depositShielded, resumeShieldedDeposit } from '../../packages/account/dist/index.js';
import { depositWorld, depositRequest } from './shielded-deposit-world.mjs';
const [root, mode] = process.argv.slice(2);
if (!root || !mode) throw Error('Explicit owned fixture required');
const world = depositWorld(root, mode);
const result =
  mode === 'resume'
    ? await resumeShieldedDeposit(depositRequest, world.ports)
    : await depositShielded(depositRequest, world.ports);
console.log(JSON.stringify({ result, stats: world.stats() }));
