// Test-only access to operation termination/overlap, never loaded by the application.
import { beforeDemoCeremony, finishDemoConsent } from '../../src/consent.ts';

Object.assign(window, {
  __consentControls: {
    finish: finishDemoConsent,
    async refused() {
      try {
        await beforeDemoCeremony({ purpose: 'identify', rpId: 'localhost', attempt: 1 });
        return 'unexpected approval';
      } catch (error) {
        return (error as { code: string }).code;
      }
    },
  },
});
