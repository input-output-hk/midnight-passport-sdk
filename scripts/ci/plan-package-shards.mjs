#!/usr/bin/env node
// Advisory only: consumes complete matching profiles, never changes the workflow.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { admitPackageProfile } from './profile-admission.mjs';
import { completePackageProfiles, partitionObservedFiles } from './package-profile.mjs';

const [, , flag, count, ...paths] = process.argv;
assert.ok(flag === '--shards' && count && /^[1-9]\d?$/.test(count));
assert.ok(paths.length > 0 && paths.length <= 32);
const samples = paths.map((path) => {
  assert.ok(statSync(path).size <= 2 * 1024 ** 2);
  return admitPackageProfile(JSON.parse(readFileSync(path, 'utf8')));
});
const complete = completePackageProfiles(samples);
console.log(JSON.stringify(partitionObservedFiles(complete, Number(count)), null, 2));
