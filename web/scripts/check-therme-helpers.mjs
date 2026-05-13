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
