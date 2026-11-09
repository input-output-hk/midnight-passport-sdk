import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeDemoCeremony, finishDemoConsent, reviewDemoAction } from '../src/consent.ts';

import { withUi, control, approve } from './fixtures/consent-ui.ts';

const context = { network: 'undeployed', arm: 'p256' as const, routineMinutes: 15 };
const ceremony = { purpose: 'identify-and-unlock' as const, rpId: 'localhost', attempt: 1 };

test('combined review stages no modal, freezes lifetime and approves one actual callback at a time', async () =>
  withUi(async (controls, frames) => {
    const mutable = { ...context };
    await reviewDemoAction('open', mutable);
    mutable.routineMinutes = 30;
    const dialog = control(controls, 'ceremony-dialog');
    assert.equal(dialog.shows, 0);
    const pending = beforeDemoCeremony(ceremony);
    assert.equal(dialog.shows, 1);
    assert.match(control(controls, 'ceremony-details').textContent, /15 minutes/);
    assert.deepEqual(
      { ...dialog.dataset, ceremonyId: '' },
      {
        ceremonyId: '',
        flowId: dialog.dataset.flowId,
        purpose: ceremony.purpose,
        attempt: '1',
        rpId: 'localhost',
      },
    );
    await assert.rejects(
      beforeDemoCeremony({ ...ceremony, purpose: 'sign' }),
      /Start an operation/,
    );
    await approve(controls, frames);
    await pending;
    const second = beforeDemoCeremony({ ...ceremony, purpose: 'sign', attempt: 2 });
    assert.equal(dialog.shows, 2);
    assert.match(control(controls, 'ceremony-details').textContent, /Retry 2/);
    control(controls, 'ceremony-cancel').click();
    await assert.rejects(second, /declined/);
    await assert.rejects(beforeDemoCeremony(ceremony), /Start an operation/);
  }));

test('creation acknowledgement belongs to first actual create review and is never inherited by a new action', async () =>
  withUi(async (controls, frames) => {
    await reviewDemoAction('create', context);
    const pending = beforeDemoCeremony({ ...ceremony, purpose: 'create' });
    const button = control(controls, 'ceremony-continue');
    assert.equal(button.disabled, true);
    button.click();
    assert.equal(control(controls, 'ceremony-dialog').open, true);
    const ack = control(controls, 'consent-retirement-ack');
    ack.checked = true;
    ack.dispatchEvent(new Event('change'));
    await approve(controls, frames);
    await pending;
    const probe = beforeDemoCeremony({ ...ceremony, purpose: 'verify-created' });
    assert.equal(control(controls, 'consent-retirement').hidden, true);
    control(controls, 'ceremony-cancel').click();
    await assert.rejects(probe, /declined/);
    await reviewDemoAction('create', context);
    const again = beforeDemoCeremony({ ...ceremony, purpose: 'create' });
    assert.equal(button.disabled, true);
    finishDemoConsent();
    await assert.rejects(again, /declined/);
  }));

test('lease checks refuse expiry during review and during the rendering frames', async () =>
  withUi(async (controls, frames) => {
    let expired = false;
    const checked = {
      ...context,
      ownerUnlocked: true,
      check: () => {
        if (expired) throw Error('Lease expired');
      },
    };
    await reviewDemoAction('rotate', checked);
    const pending = beforeDemoCeremony({ ...ceremony, purpose: 'derive-keys' });
    expired = true;
    control(controls, 'ceremony-continue').click();
    await assert.rejects(pending, /Lease expired/);
    assert.equal(frames.length, 0);
    expired = false;
    await reviewDemoAction('rotate', checked);
    const painted = beforeDemoCeremony({ ...ceremony, purpose: 'derive-keys' });
    await approve(controls, frames, () => {
      expired = true;
    });
    await assert.rejects(painted, /Lease expired/);
    assert.equal(control(controls, 'ceremony-purpose').dataset.ready, 'false');
  }));

test('missing action, wrong RP, invalid attempt and terminated review never approve browser access', async () =>
  withUi(async (controls) => {
    await assert.rejects(beforeDemoCeremony(ceremony), /Start an operation/);
    await reviewDemoAction('open', context);
    await assert.rejects(
      beforeDemoCeremony({ ...ceremony, rpId: 'example.com' }),
      /Start an operation/,
    );
    await assert.rejects(beforeDemoCeremony({ ...ceremony, attempt: 0 }), /Start an operation/);
    assert.equal(control(controls, 'ceremony-dialog').shows, 0);
    const pending = beforeDemoCeremony(ceremony);
    finishDemoConsent();
    assert.equal(control(controls, 'ceremony-dialog').open, false);
    await assert.rejects(pending, /declined/);
  }));

test('full-owner memory risk is part of the existing single ceremony review', async () =>
  withUi(async (controls, frames) => {
    await reviewDemoAction('unlockOwner', { ...context, routineMinutes: 10 });
    const pending = beforeDemoCeremony({ ...ceremony, purpose: 'derive-keys' });
    assert.equal(control(controls, 'ceremony-dialog').shows, 1);
    const text = control(controls, 'ceremony-details').textContent;
    assert.match(text, /page-memory access/);
    assert.match(text, /does not revoke/);
    assert.match(text, /10 minutes/);
    await approve(controls, frames);
    await pending;
    assert.equal(control(controls, 'ceremony-dialog').shows, 1);
  }));
