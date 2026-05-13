// web/scripts/check-therme-helpers.mjs
//
// Manual driver for thermeModel.js. Repo has no test framework (see
// CLAUDE.md). Run with:
//
//   node web/scripts/check-therme-helpers.mjs
//
// Spot-check the printed totals against the known burner runs on 2026-05-10.

import { bucketsForRange } from '../src/api/thermeModel.js';

const grid = bucketsForRange(
  '2026-05-10T00:00:00Z',
  '2026-05-11T00:00:00Z',
  'hour',
);

console.log('grid length (hour, 1 day):', grid.length);
console.log('grid[0]:', grid[0]);
console.log('grid[grid.length - 1]:', grid[grid.length - 1]);

const fiveMin = bucketsForRange(
  '2026-05-10T04:00:00Z',
  '2026-05-10T05:00:00Z',
  '5minute',
);
console.log('grid length (5min, 1 hour):', fiveMin.length);

import { bucketHeatEnergyKwh } from '../src/api/thermeModel.js';

// Subset of sensor.weishaupt_warmeenergie state changes on 2026-05-10
// (taken from the user-provided sample). Burner ran roughly 04:20-04:33,
// 06:16-06:32, 10:18-10:35, 15:36-15:53, 18:20-18:39.
const heatStates = [
  { last_changed: '2026-05-10T02:54:34.472Z', state: '656.30' },
  { last_changed: '2026-05-10T02:57:14.394Z', state: '525.32' },
  { last_changed: '2026-05-10T02:58:18.383Z', state: '123.30' },
  { last_changed: '2026-05-10T02:59:22.291Z', state: '-370.20' },
  { last_changed: '2026-05-10T04:20:26.382Z', state: '708.00' },
  { last_changed: '2026-05-10T04:20:58.430Z', state: '1160.38' },
  { last_changed: '2026-05-10T04:22:02.227Z', state: '43.93' },
  { last_changed: '2026-05-10T04:24:10.412Z', state: '-1381.72' },
  { last_changed: '2026-05-10T04:26:18.281Z', state: '859.13' },
  { last_changed: '2026-05-10T04:26:50.404Z', state: '507.78' },
  { last_changed: '2026-05-10T10:18:54.350Z', state: '526.62' },
  { last_changed: '2026-05-10T10:19:26.314Z', state: '1338.01' },
];

const kwh = bucketHeatEnergyKwh(heatStates, grid);
const nonZero = kwh.filter((k) => k.value !== 0);
console.log('\nbucketHeatEnergyKwh non-zero buckets:');
for (const k of nonZero) console.log(`  ${k.start}  ${k.value.toFixed(3)} kWh`);

import { bucketBurnerMinutes } from '../src/api/thermeModel.js';

// Burner phase transitions on 2026-05-10 (compressed).
const burnerStates = [
  { last_changed: '2026-05-10T02:54:34.469Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T02:59:22.281Z', state: 'Nachbelüftung' },
  { last_changed: '2026-05-10T02:59:54.396Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T04:20:26.378Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T04:24:10.410Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T04:26:18.279Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T04:32:42.238Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T06:16:45.325Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T06:28:29.369Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T10:18:54.346Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T10:32:46.179Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T15:36:48.269Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T15:50:41.199Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T18:20:34.145Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T18:36:34.379Z', state: 'Brenner aus' },
];

const burnerMin = bucketBurnerMinutes(burnerStates, grid);
const totalMin = burnerMin.reduce((s, r) => s + r.value, 0);
console.log('\nbucketBurnerMinutes total on 2026-05-10:', totalMin.toFixed(1), 'min');
console.log('non-zero buckets:');
for (const r of burnerMin.filter((b) => b.value > 0)) {
  console.log(`  ${r.start}  ${r.value.toFixed(2)} min`);
}
