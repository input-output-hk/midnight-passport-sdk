import { ACC_CAPABILITIES } from '@input-output-hk/mn-passport-contract/capabilities';
import {
  getAccountProofRequirements,
  type AccountPreflightOperation,
} from '@input-output-hk/mn-passport-account/preflight';

/** Advisory public-package inspection. No credential, lazy binding, prover or service is invoked. */
export function showDemoCapabilities(arm: 'p256' | 'jubjub'): void {
  const operation = document.getElementById('capability-operation') as HTMLSelectElement;
  const read = document.getElementById('capability-read-grant') as HTMLInputElement;
  const output = document.getElementById('capability-report')!;
  const summary = document.getElementById('capability-summary')!;
  summary.textContent = `Binding ${ACC_CAPABILITIES.binding.id}; ${ACC_CAPABILITIES.circuits.filter((c) => c.kind === 'proof').length} proof circuits and ${ACC_CAPABILITIES.circuits.filter((c) => c.kind === 'pure').length} pure helpers distributed. Selected owner arm: ${arm}. Distribution does not mean every circuit has a typed API or demo action.`;
  const render = () => {
    const selected = operation.value as AccountPreflightOperation;
    read.disabled = selected !== 'issue-grant';
    const plan = getAccountProofRequirements(arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr', {
      operation: selected,
      ...(selected === 'issue-grant' && { grantRead: read.checked }),
    });
    output.textContent = JSON.stringify(
      {
        status: 'advisory-proof-plan-only',
        ...plan,
        unverified: [
          'host port configuration',
          'actual key endpoint and artifact bytes',
          'live account and balances',
          'reader/grant openings',
          'passkey provider',
          'proof/submission/finality',
        ],
      },
      null,
      2,
    );
  };
  operation.addEventListener('change', render);
  read.addEventListener('change', render);
  render();
}
