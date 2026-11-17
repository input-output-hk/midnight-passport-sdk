import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shell = `
set -euo pipefail
. "$DRAIN_HELPER"
node -e 'process.on("SIGTERM", () => process.exit(Number(process.env.DRAIN_EXIT))); require("node:fs").writeFileSync(process.env.READY_FILE, "ready"); setInterval(() => {}, 1000)' &
service=$!
for _ in $(seq 1 100); do
  [ -f "$READY_FILE" ] && break
  sleep 0.02
done
[ -f "$READY_FILE" ]
drain_shared_service "$service"
`;

for (const exitCode of [0, 1]) {
  test(`shared sponsor drain requires service exit 0 (observed ${exitCode})`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'passport-drain-'));
    try {
      const result = spawnSync('bash', ['-c', shell], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          DRAIN_HELPER: join(root, 'scripts/midnight-service-drain.sh'),
          DRAIN_EXIT: String(exitCode),
          READY_FILE: join(directory, 'ready'),
        },
      });
      assert.equal(result.error, undefined);
      assert.equal(existsSync(join(directory, 'ready')), true);
      assert.equal(result.status, exitCode);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
