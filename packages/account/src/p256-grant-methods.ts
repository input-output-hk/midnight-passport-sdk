import type { P256AccountContext, P256MethodArgs } from './p256-account-context.js';
import type { P256Hint } from './p256-device.js';
import { isSealedP256 } from './p256-device.js';
import { PassportConnectorError } from './errors.js';
import { snapshotGrantScope } from './request-snapshots.js';
import { issueAndPublishP256Grant, type IssueP256GrantPure } from './p256-grant-issue.js';
import { recoverPendingP256Grants } from './p256-grant-publication.js';
import type { GrantRecoveryJournal } from './jubjub-grant-publication.js';
import type { AccPureCircuits } from './ports/index.js';
import type { ViewingKeyRotationResult } from '@input-output-hk/mn-passport-protocol';
const requireP256GrantPure = (
  value: unknown,
): IssueP256GrantPure &
  AccPureCircuits & {
    challenge_append_inbox_with_p256: NonNullable<
      AccPureCircuits['challenge_append_inbox_with_p256']
    >;
  } => {
  const pure = value as Partial<IssueP256GrantPure & AccPureCircuits>;
  for (const name of [
    'derive_grant_id_with_jubjub',
    'derive_grant_object_commit',
    'derive_grant_scope_digest',
    'derive_device_entry_with_p256',
    'challenge_issue_grant_with_p256',
    'challenge_append_inbox_with_p256',
  ] as const)
    if (typeof pure[name] !== 'function')
      throw new PassportConnectorError('BindingUnsupported', `ACC binding lacks ${name}.`);
  return pure as IssueP256GrantPure &
    AccPureCircuits & {
      challenge_append_inbox_with_p256: NonNullable<
        AccPureCircuits['challenge_append_inbox_with_p256']
      >;
    };
};

export class P256GrantMethods {
  constructor(
    private readonly host: P256AccountContext,
    private readonly record: P256Hint,
  ) {}
  issueGrant = async (
    scope: P256MethodArgs<'issueGrant'>[0],
    options: P256MethodArgs<'issueGrant'>[1] = {},
  ) => {
    const {
      ports,
      network,
      networkId,
      viewingKey,
      binding,
      chain,
      authoriser,
      random,
      rotateP256ViewingKey,
    } = this.host;
    const record = this.record;
    scope = snapshotGrantScope(scope);
    if (
      !isSealedP256(record) ||
      !viewingKey ||
      !ports.records ||
      !ports.grants ||
      !ports.grantCommitments ||
      !ports.grantJournal ||
      !ports.grantOrigin
    )
      throw new PassportConnectorError(
        'BindingUnsupported',
        'P-256 grant issue needs sealed keys, local records, live grants, durable journal and host origin.',
      );
    if (
      scope.read &&
      (!ports.holdings || !ports.readGrants || !viewingKey.reencryptInbox || !viewingKey.sealView)
    )
      throw new PassportConnectorError(
        'BindingUnsupported',
        'Read grants need verified holdings, live read grants and a full viewing-key port.',
      );
    if (network.bindingId !== 'acc-s3r1.1')
      throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
    const pure = requireP256GrantPure((await binding()).pureCircuits);
    return issueAndPublishP256Grant(
      { hint: record, origin: ports.grantOrigin, scope, ...options },
      {
        bindingId: 'acc-s3r1.1',
        networkId,
        pure,
        chain: await chain(),
        authoriser,
        records: ports.records,
        grants: ports.grants,
        commitments: ports.grantCommitments,
        journal: ports.grantJournal,
        viewingKey,
        random,
        ...(scope.read && {
          rotateBeforeIssue: () =>
            rotateP256ViewingKey(record, options) as Promise<ViewingKeyRotationResult>,
        }),
      },
    );
  };
  recoverPendingGrants = async (options: P256MethodArgs<'recoverPendingGrants'>[0] = {}) => {
    const { ports, network, networkId, viewingKey, binding, chain, authoriser, random } = this.host;
    const record = this.record;
    if (
      !isSealedP256(record) ||
      !viewingKey ||
      !ports.records ||
      !ports.grants ||
      !ports.grantCommitments ||
      !ports.grantJournal ||
      typeof (ports.grantJournal as Partial<GrantRecoveryJournal>).pending !== 'function'
    )
      throw new PassportConnectorError(
        'BindingUnsupported',
        'P-256 grant recovery needs sealed keys, local records, live grants and pending journal enumeration.',
      );
    if (network.bindingId !== 'acc-s3r1.1')
      throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
    const pure = requireP256GrantPure((await binding()).pureCircuits);
    return recoverPendingP256Grants(
      { hint: record, ...options },
      {
        bindingId: 'acc-s3r1.1',
        networkId,
        pure,
        chain: await chain(),
        grants: ports.grants,
        commitments: ports.grantCommitments,
        journal: ports.grantJournal as GrantRecoveryJournal,
        viewingKey,
        authoriser,
        records: ports.records,
        random,
      },
    );
  };
}
