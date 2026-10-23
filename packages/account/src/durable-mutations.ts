import { utf8ToBytes } from '@noble/hashes/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createPassportAccounts } from './connector.js';
import { PassportConnectorError } from './errors.js';
import {
  mutationDigest,
  mutationFailure,
  validateMutationDocument,
  encodeMutationValue,
  decodeMutationValue,
} from './mutation-codec.js';
import {
  mutationLedger,
  mutationView,
  predictMutationLedger,
  sameMutationLedger,
} from './mutation-ledger.js';
import type { PassportPorts, CallRequest, Chain } from './ports/index.js';
import type {
  MutationAudit,
  MutationConsent,
  MutationDocument,
  MutationEffect,
  MutationEntry,
  MutationIntent,
  MutationJournal,
  MutationOutcomeSource,
  MutationRunOptions,
  MutationLedger,
} from './mutation-types.js';

export interface DurableMutationPorts {
  readonly ports: PassportPorts;
  readonly journal: MutationJournal;
  readonly outcomes: MutationOutcomeSource;
  readonly consent: MutationConsent;
}
export interface DurableMutationResult {
  readonly id: string;
  readonly account: string;
  readonly result: unknown;
}
const callInput = (request: CallRequest) => ({
  address: request.address,
  circuit: request.circuit,
  args: request.args,
});
const audit = (d: MutationDocument): MutationAudit => ({
  id: d.id,
  revision: d.revision,
  phase: d.phase,
  completedSteps: d.entries.filter((e) => e.phase === 'done').length,
  unresolvedEffects: d.entries.filter((e) => e.effect && e.phase !== 'done').length,
});
const checkpoint = (options: MutationRunOptions) => {
  if (options.signal?.aborted)
    throw new PassportConnectorError(
      'Aborted',
      'Mutation invocation cancelled; submitted transactions are not undone.',
    );
};
const random = (length: number) =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));

/** Opt-in protected continuation, separate from the legacy non-durable account API.
 * Each invocation approves the original intent. Replays cached public/ciphertext results, not
 * secrets; reconciles the actual frontier before further effects. Never guesses a lost receipt.
 */
export function createDurablePassportMutations({
  ports,
  journal,
  outcomes,
  consent,
}: DurableMutationPorts) {
  const pins = {
    networkId: ports.network.networkId,
    bindingId: ports.network.bindingId,
    manifestSha256: ports.network.manifestSha256,
    scheme: ports.authoriser.scheme,
  };
  const load = async (id: string) => {
    if (!/^[0-9a-f]{32}$/.test(id))
      return mutationFailure('Mutation ID must be 16-byte lowercase hex.');
    const d = await journal.read(id);
    if (d) {
      validateMutationDocument(d);
      if (mutationDigest(d.pins) !== mutationDigest(pins))
        return mutationFailure('Mutation network, binding or arm differs.');
    }
    return d;
  };
  const execute = async (
    intent: MutationIntent,
    options: MutationRunOptions,
    allowCancelled = false,
  ): Promise<DurableMutationResult> => {
    intent = decodeMutationValue(encodeMutationValue(intent)) as MutationIntent;
    if (!ports.viewingKey || !ports.directory || !ports.records)
      return mutationFailure(
        'Durable owner flows require sealed keys, directory and local records.',
      );
    let doc = await load(options.id);
    if (doc && mutationDigest(doc.intent) !== mutationDigest(intent))
      return mutationFailure('The original mutation intent or lock choice differs.');
    await consent.approve({
      id: options.id,
      pins: { ...pins },
      intent: decodeMutationValue(encodeMutationValue(intent)) as MutationIntent,
      resuming: doc !== undefined,
    });
    checkpoint(options);
    if (doc?.phase === 'cancelled' && !allowCancelled)
      return mutationFailure('Mutation is cancelled; explicitly approve resumption.');
    const save = async (update: Partial<MutationDocument>) => {
      const previous = doc;
      const next: MutationDocument = {
        ...doc!,
        ...update,
        revision: previous ? previous.revision + 1 : 0,
      };
      validateMutationDocument(next);
      if (!(await journal.compareAndSwap(options.id, previous?.revision, next)))
        return mutationFailure('Mutation journal changed concurrently.');
      doc = next;
    };
    if (!doc)
      await save({
        version: 1,
        id: options.id,
        pins,
        intent,
        randomSeed: (ports.random ?? random)(32),
        phase: 'pending',
        entries: [],
      });
    if (doc!.phase === 'cancelled') await save({ phase: 'pending' });
    const chain = typeof ports.chain === 'function' ? await ports.chain() : ports.chain;
    const binding = typeof ports.binding === 'function' ? await ports.binding() : ports.binding;
    const deployReceipt = (value: unknown) => {
      const result = value as { address?: unknown; txIds?: unknown } | undefined;
      if (
        !result ||
        typeof result.address !== 'string' ||
        !/^[0-9a-f]{64}$/.test(result.address) ||
        !Array.isArray(result.txIds) ||
        !result.txIds.length ||
        !result.txIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
      )
        return mutationFailure('Deployment receipt is incomplete.');
      return { address: result.address, txIds: result.txIds as string[] };
    };
    const checkDeployment = (current: MutationLedger, encKey: Uint8Array) => {
      if (
        current.booted ||
        current.authNonce !== 0n ||
        current.entryCount !== 0 ||
        mutationDigest(current.encKey) !== mutationDigest(encKey)
      )
        return mutationFailure('The deployed ACC differs from the durable creation intent.');
    };
    const readLive = async (address: string) =>
      mutationLedger(
        await chain.readAccount(address, { includeInbox: true, includeDevices: true }),
      );
    const ensureFrontier = async () => {
      if (
        doc!.frontier &&
        !sameMutationLedger(await readLive(doc!.frontier.address), doc!.frontier.ledger)
      )
        return mutationFailure(
          'The chain differs from the recorded mutation frontier; reconcile before continuing.',
        );
    };
    const replace = async (
      index: number,
      entry: MutationEntry,
      frontier?: MutationDocument['frontier'],
    ) => {
      const entries = [...doc!.entries];
      entries[index] = entry;
      await save({ entries, ...(frontier && { frontier }) });
    };
    // Recover only a host-attested outcome for the exact protected request. Ledger absence alone
    // never proves no submission. A confirmed call must also match its predicted full ACC state.
    const unresolved = doc!.entries.findIndex((e) => e.effect && e.phase === 'running');
    if (unresolved >= 0) {
      const entry = doc!.entries[unresolved]!,
        effect = entry.effect!;
      const outcome = await outcomes.reconcile(pins, effect);
      if (outcome.kind === 'unknown' || outcome.digest !== effect.digest)
        return mutationFailure('Submission outcome is unknown or names another intent.');
      if (outcome.kind === 'not-submitted') {
        if (outcome.fenced !== true)
          return mutationFailure('An earlier sender is not fenced; replay is forbidden.');
        await ensureFrontier();
        await replace(unresolved, { ...entry, phase: 'prepared' });
      } else {
        const result = outcome.result;
        if (effect.kind === 'call') {
          if (
            !('txHash' in result) ||
            typeof result.txHash !== 'string' ||
            !result.txHash ||
            !effect.after ||
            !effect.address ||
            !sameMutationLedger(await readLive(effect.address), effect.after)
          )
            return mutationFailure('Confirmed call receipt or resulting ledger is inconsistent.');
          await replace(
            unresolved,
            { ...entry, phase: 'done', result },
            { address: effect.address, ledger: effect.after },
          );
        } else {
          const deployed = deployReceipt(result);
          const current = await readLive(deployed.address);
          const input = effect.input as { encKey: Uint8Array };
          checkDeployment(current, input.encKey);
          await replace(
            unresolved,
            { ...entry, phase: 'done', result },
            { address: deployed.address, ledger: current },
          );
        }
      }
    }
    const settleLocal = async () => {
      const record = [...doc!.entries]
        .reverse()
        .find((e) => e.name === 'record.write' && e.phase === 'done')?.result as Awaited<
        ReturnType<NonNullable<PassportPorts['records']>['read']>
      >;
      if (record) {
        const held = await ports.records!.read();
        if (!held) await ports.records!.write(record);
        else if (mutationDigest(held) !== mutationDigest(record))
          return mutationFailure(
            'The local record differs from the durable final state; reconcile it explicitly.',
          );
      }
      const hint = [...doc!.entries]
        .reverse()
        .find((e) => e.name === 'directory.put' && e.phase === 'done')?.result as
        Parameters<NonNullable<PassportPorts['directory']>['put']>[1] | undefined;
      if (hint?.credentialId) {
        const held = await ports.directory!.get(pins.networkId, {
          kind: 'credential-id',
          credentialId: hint.credentialId,
        });
        if (!held) await ports.directory!.put(pins.networkId, hint);
        else if (mutationDigest(held) !== mutationDigest(hint))
          return mutationFailure(
            'The directory differs from the durable final hint; reconcile it explicitly.',
          );
      }
    };
    await ensureFrontier();
    if (doc!.phase === 'complete') {
      await settleLocal();
      return doc!.result as DurableMutationResult;
    }
    let cursor = 0,
      randomCounter = 0;
    const trace = async <T>(
      name: string,
      input: unknown,
      work: () => Promise<T>,
      verify = false,
    ): Promise<T> => {
      const index = cursor++,
        digest = mutationDigest(input),
        old = doc!.entries[index];
      if (old) {
        if (old.name !== name || old.digest !== digest || old.effect)
          return mutationFailure('Mutation continuation diverged from the recorded program.');
        if (old.phase === 'running')
          return mutationFailure(
            'The key origin must recover its original sealed output; replacement generation is forbidden.',
          );
        if (old.phase === 'done') {
          if (verify && mutationDigest(await work()) !== mutationDigest(old.result))
            return mutationFailure('The selected key origin or verified inputs changed.');
          return old.result as T;
        }
      }
      checkpoint(options);
      const entry = { name, digest, phase: 'prepared' as const };
      if (!old) await replace(index, entry);
      if (name.startsWith('viewing.') || name === 'credential.create')
        await replace(index, { ...entry, phase: 'running' });
      const result = await work();
      await replace(index, { ...entry, phase: 'done', result });
      return result;
    };
    const effect = async <T>(
      name: string,
      input: unknown,
      prepare: () => Promise<Omit<MutationEffect, 'key' | 'digest' | 'input'>>,
      work: (effect: MutationEffect) => Promise<T>,
    ): Promise<T> => {
      const index = cursor++,
        digest = mutationDigest(input);
      let old = doc!.entries[index];
      if (old) {
        if (old.name !== name || old.digest !== digest || !old.effect)
          return mutationFailure('Mutation chain intent changed.');
        if (old.phase === 'done') return old.result as T;
        if (old.phase === 'running')
          return mutationFailure('Unresolved submission cannot be replayed.');
      }
      checkpoint(options);
      await ensureFrontier();
      if (!old) {
        const effect: MutationEffect = {
          ...(await prepare()),
          key: `${options.id}:${index}`,
          digest,
          input,
        };
        old = { name, digest, phase: 'prepared', effect };
        await replace(index, old);
      }
      await replace(index, { ...old, phase: 'running' });
      // A throw may happen after broadcast. Leave running durable until authoritative reconciliation.
      const result = await work(old.effect!);
      const expected = old.effect!.after;
      const address = old.effect!.address;
      if (expected && address) {
        if (
          !result ||
          typeof (result as { txHash?: unknown }).txHash !== 'string' ||
          !(result as { txHash?: unknown }).txHash
        )
          return mutationFailure('A finalized mutation transaction ID is required.');
        // This port promises finality; an indexer that has not caught up must be reconciled,
        // never treated as successful durable state.
        if (!sameMutationLedger(await readLive(address), expected))
          return mutationFailure(
            'Submitted mutation has not settled to its exact expected ledger.',
          );
        await replace(index, { ...old, phase: 'done', result }, { address, ledger: expected });
      } else {
        const deployed = deployReceipt(result);
        const current = await readLive(deployed.address);
        const request = input as { encKey: Uint8Array };
        checkDeployment(current, request.encKey);
        await replace(
          index,
          { ...old, phase: 'done', result },
          { address: deployed.address, ledger: current },
        );
      }
      return result;
    };
    const wrappedChain: Chain = {
      async readAccount(address, options) {
        const raw = await trace<MutationLedger | undefined>(
          'chain.read',
          { address, options },
          async () => {
            const view = await chain.readAccount(address, {
              includeInbox: true,
              includeDevices: true,
            });
            return view ? mutationLedger(view) : undefined;
          },
        );
        if (raw && !doc!.frontier) await save({ frontier: { address, ledger: raw } });
        return raw ? mutationView(raw) : undefined;
      },
      async call(request) {
        return effect(
          'chain.call',
          callInput(request),
          async () => {
            const before = await readLive(request.address);
            return {
              kind: 'call',
              address: request.address,
              before,
              after: predictMutationLedger(before, request, binding),
            };
          },
          (e) => chain.call({ ...request, mutation: { requestId: e.key, intentSha256: e.digest } }),
        );
      },
    };
    const wrap = <T extends object>(
      object: T,
      names: readonly (keyof T)[],
      prefix: string,
      verify = false,
    ): T => {
      const result = { ...object };
      for (const key of names) {
        const method = object[key];
        if (typeof method !== 'function') continue;
        (result as Record<string, unknown>)[String(key)] = (...args: unknown[]) =>
          trace(
            `${prefix}.${String(key)}`,
            args,
            () => method.apply(object, args) as Promise<unknown>,
            verify,
          );
      }
      return result;
    };
    const authoriser = wrap(
      ports.authoriser,
      ['devicePublicKey', 'devicePublicKeyHex', 'deviceBinding', 'deviceCommitments'],
      'authoriser',
      true,
    );
    authoriser.authorise = (request) =>
      trace(
        'authoriser.sign',
        {
          ...request,
          challenge: typeof request.challenge === 'function' ? undefined : request.challenge,
        },
        () => ports.authoriser.authorise(request),
      );
    if (ports.authoriser.withKeySession)
      authoriser.withKeySession = (operation, descriptor) =>
        ports.authoriser.withKeySession!(async () => {
          await trace('consent.flow', descriptor, async () => true);
          return operation();
        }, descriptor);
    const viewing = wrap(
      ports.viewingKey!,
      ['createKeys', 'sealToDevice', 'reencryptInbox', 'sealView', 'sealGrant'],
      'viewing',
    );
    const credentials = {
      ...ports.credentials,
      create: (user: { readonly name: string }) =>
        trace('credential.create', user, () => ports.credentials.create(user)),
      identify: async () => {
        const identity = await ports.credentials.identify();
        await trace(
          'credential.identify',
          {},
          async () => ({ credentialId: identity.credentialId }),
          true,
        );
        return identity;
      },
    };
    const protectedPorts: PassportPorts = {
      ...ports,
      binding,
      chain: wrappedChain,
      authoriser,
      credentials,
      viewingKey: viewing,
      directory: {
        ...wrap(ports.directory!, ['get'], 'directory'),
        put: async (network, hint) => {
          await trace('directory.put', { network, hint }, async () => {
            await ports.directory!.put(network, hint);
            return hint;
          });
        },
      },
      records: {
        ...wrap(ports.records!, ['read', 'exists'], 'record'),
        write: async (record) => {
          await trace('record.write', record, async () => {
            await ports.records!.write(record);
            return record;
          });
        },
      },
      ...(ports.holdings && {
        holdings: wrap(ports.holdings, ['selectHeldEntries'], 'holdings', true),
      }),
      ...(ports.readGrants && {
        readGrants: wrap(ports.readGrants, ['readActiveReadGrantTargets'], 'grants'),
      }),
      random: (length) => {
        if (!Number.isInteger(length) || length < 1 || length > 32)
          return mutationFailure('Unsupported durable random request.');
        return hmac(
          sha256,
          doc!.randomSeed,
          utf8ToBytes(`${options.id}:${randomCounter++}:${length}`),
        ).slice(0, length);
      },
      deployer: {
        deploy: (request) =>
          effect(
            'deploy',
            {
              boot: request.boot,
              encKey: request.encKey,
              retireAuthority: request.retireAuthority,
              firstArm: request.firstArm,
            },
            async () => ({ kind: 'deploy' }),
            (e) =>
              ports.deployer.deploy({
                ...request,
                mutation: { requestId: e.key, intentSha256: e.digest },
              }),
          ),
      },
    };
    const api = createPassportAccounts(protectedPorts);
    const flowOptions = {
      ...(options.signal && { signal: options.signal }),
      ...(options.onEvent && { onEvent: options.onEvent }),
    };
    let account: string, result: unknown;
    if (intent.kind === 'create') {
      const opened = await api.createAccount({
        ...flowOptions,
        userName: intent.userName,
        retireAuthority: intent.retireAuthority,
      });
      account = opened.address;
      result = { address: account };
    } else {
      if (!api.openAccountAt)
        return mutationFailure('The selected account composition cannot open by address.');
      const opened = await api.openAccountAt(intent.account, flowOptions);
      account = opened.address;
      if (intent.kind === 'rotate') result = await opened.rotateViewingKey!(flowOptions);
      else if (intent.kind === 'add-device')
        result = await opened.addDevice!(intent.reader, flowOptions);
      else result = await opened.removeDevice!(intent.commitmentHex, flowOptions);
    }
    if (cursor !== doc!.entries.length)
      return mutationFailure('The mutation stopped before consuming its recorded continuation.');
    await ensureFrontier();
    await settleLocal();
    const answer = { id: options.id, account, result };
    await save({ phase: 'complete', result: answer });
    return answer;
  };
  return {
    run: (intent: MutationIntent, options: MutationRunOptions) => execute(intent, options),
    async resume(options: MutationRunOptions & { readonly resumeCancelled?: boolean }) {
      const doc = await load(options.id);
      if (!doc) return mutationFailure('No durable mutation exists.');
      return execute(doc.intent, options, options.resumeCancelled);
    },
    async inspect(id: string): Promise<MutationAudit | undefined> {
      const doc = await load(id);
      return doc ? audit(doc) : undefined;
    },
    async cancel(id: string) {
      const doc = await load(id);
      if (!doc) return mutationFailure('No durable mutation exists.');
      if (doc.phase === 'complete') return audit(doc);
      const next = { ...doc, revision: doc.revision + 1, phase: 'cancelled' as const };
      if (!(await journal.compareAndSwap(id, doc.revision, next)))
        return mutationFailure('Mutation journal changed concurrently.');
      return audit(next);
    },
  };
}
