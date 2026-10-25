import { runLiveOutages } from './live-outages.mjs';
process.env.PASSPORT_LIVE_PROFILE = 'wallet';
await runLiveOutages();
