// A functional mounted receipt remains distinct from an interruption cleanup receipt.
import { join } from 'node:path';
import { put } from './files.mjs';

/** @param {{root:string,source:string,runnerSha256:string,receipt:import('./mounted-interval.mjs').IntervalReceipt,resources:import('./resources.mjs').Resource[]}} value */
export function writeMountedSummary(value) {
  const { root, source, runnerSha256, receipt, resources } = value;
  put(
    join(root, 'summary.json'),
    JSON.stringify(
      {
        kind: 'mounted-production-source-client',
        source,
        runnerSha256,
        verdict: receipt.verdict,
        functional: receipt.functional,
        inputsUnchanged: receipt.inputsUnchanged,
        quiescent: receipt.quiescent,
        leaseReleased: receipt.leaseReleased,
        resources: resources.map(({ kind, id, createdAt }) => ({ kind, id, createdAt })),
        retainedVolumes: resources.filter((row) => row.kind === 'volume').length + 1,
        syntheticCredentials: true,
        registryInstalledNative: false,
        jobBackedImageFaults: false,
        realProvider: false,
        fullLace: false,
      },
      null,
      2,
    ) + '\n',
  );
}
