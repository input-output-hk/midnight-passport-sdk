/** Coverage floors use raw counters, not rounded display percentages. */
export const coverageThresholds = Object.freeze({ lines: 80, functions: 80, branches: 80 });

/** @param {Record<string, {covered:number,total:number}>} counters */
export function coverageFailures(counters) {
  const failures = [];
  for (const [metric, floor] of Object.entries(coverageThresholds)) {
    const count = counters[metric];
    if (
      !count ||
      !Number.isSafeInteger(count.total) ||
      !Number.isSafeInteger(count.covered) ||
      count.total < 0 ||
      count.covered < 0 ||
      count.covered > count.total
    ) {
      failures.push(`Invalid ${metric} counters.`);
    } else if (count.total && count.covered * 100 < count.total * floor) {
      failures.push(`${metric} coverage is below ${floor}%.`);
    }
  }
  return failures;
}

/**
 * @param {readonly {source:string,package:string,executable:boolean}[]} inventory
 * @param {ReadonlySet<string>} measured
 * @param {readonly string[]} expectedPackages
 */
export function coverageInventoryFailures(inventory, measured, expectedPackages) {
  const failures = inventory
    .filter((file) => file.executable && !measured.has(file.source))
    .map((file) => `Missing source coverage: ${file.source}`);
  const packages = [...new Set(inventory.map((file) => file.package))].sort();
  if (JSON.stringify(packages) !== JSON.stringify([...expectedPackages].sort()))
    failures.push('Coverage package inventory differs from the approved nine-package release set.');
  return failures;
}
