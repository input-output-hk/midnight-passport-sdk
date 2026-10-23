// Opt-in source qualification; no provider or full release claim.
import { runLiveOutages } from './live-outages.mjs';
process.env.PASSPORT_LIVE_PROFILE = 'combined';
await runLiveOutages();
