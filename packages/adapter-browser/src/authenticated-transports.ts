import type {
  Chain,
  FeeSponsor,
  Prover,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';

interface Transports {
  readonly prover: Prover;
  readonly sponsor: FeeSponsor;
  readonly submitter: Submitter;
  readonly valueCalls?: Pick<Chain, 'call'>;
}

/** Check immediately before handing work to a transport, never after its acknowledgement.
 * Custom transports with asynchronous preparation must also check at their actual dispatch.
 * A dispatched signed request can settle after local lock; its original result must survive.
 */
export function authenticatedOwnerTransports(check: () => void, ports: Transports): Transports {
  return {
    prover: {
      proveTx: (...args) => {
        check();
        return ports.prover.proveTx(...args);
      },
    },
    sponsor: {
      ...(ports.sponsor.supportsShieldedOffers !== undefined && {
        supportsShieldedOffers: ports.sponsor.supportsShieldedOffers,
      }),
      balanceAndSign: (...args) => {
        check();
        return ports.sponsor.balanceAndSign(...args);
      },
    },
    submitter: {
      submit: (...args) => {
        check();
        return ports.submitter.submit(...args);
      },
    },
    ...(ports.valueCalls && {
      valueCalls: {
        call: (...args: Parameters<Chain['call']>) => {
          check();
          return ports.valueCalls!.call(...args);
        },
      },
    }),
  };
}
