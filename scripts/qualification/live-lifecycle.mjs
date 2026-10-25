import { runLiveOutages } from './live-outages.mjs';
process.env.PASSPORT_LIVE_PROFILE = 'lifecycle';
await runLiveOutages();
