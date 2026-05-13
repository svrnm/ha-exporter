# Color-code in/out rows in the Grid and Battery bubbles

**Date:** 2026-05-13
**Component:** `web/src/components/EnergyFlowDiagram.jsx`

## Problem

The Grid and Battery bubbles on the Summary's energy flow diagram each show
two rows — imported vs returned (grid), and charged vs discharged (battery).
Today both rows share a single color (`c.grid` for the grid bubble,
`c.battery` for the battery bubble) and direction is conveyed only by an
arrow glyph (`←`/`→`, `↓`/`↑`). A first-time reader has to parse the arrow
to know which value is which. The diagram's edge lines are already colored
by the source of the energy that travels them, but the bubbles ignore that
vocabulary.

## Goal

Make direction legible at a glance by coloring each row with the color of
the energy source for that direction, reusing the palette the edges already
use.

## Color mapping

| Bubble  | Row              | Color                | Source it represents                                  |
|---------|------------------|----------------------|-------------------------------------------------------|
| Grid    | `←` `gridIn`     | `c.grid` (blue)      | Energy imported from the grid. Same as today.         |
| Grid    | `→` `gridOut`    | `c.solar` (amber)    | Exports typically originate from PV surplus.          |
| Battery | `↓` `batteryIn`  | `c.solar` (amber)    | Charging typically comes from PV.                     |
| Battery | `↑` `batteryOut` | `c.battery` (violet) | Discharge sourced from the battery itself. Unchanged. |

The rule is "color by the typical source of the flow," matching the colors
used on the corresponding edge lines (`pv→grid`, `pv→battery`, `grid→home`,
`battery→home`). This keeps a single visual vocabulary across the diagram.

### Heuristic note

`gridOut` can technically include `batteryToGrid` (battery → grid export),
and `batteryIn` can include `gridToBattery` (grid → battery charging). The
bubble shows a total, not a split by sub-source, so picking the *typical*
dominant source is a deliberate simplification. Computing the dominant
source per render would cause colors to flip between periods, which would
be more confusing than the static heuristic.

## Visual treatment

Both the arrow glyph **and** the kWh number get the row color. Today only
the arrow is colored (via `l.color`) and the number sits in
`theme.palette.text.primary`. The new behavior pulls the number's `fill` to
`l.color` as well, giving each row a uniform color block. The label below
the bubble (`"Netz"`, `"Batterie"`) stays neutral
(`theme.palette.text.secondary`) so the bubble's identity is unchanged.

## Implementation

Two changes inside `EnergyFlowDiagram.jsx`:

1. Update the `lines` arrays passed to `DualArrowNode` (grid) and
   `BatterySegmentedNode` (battery) so each row carries the new color per
   the table above. The components already accept a per-line `color` field.
2. In both `DualArrowNode` and `BatterySegmentedNode`, change the parent
   `<text>` element so its `fill` is `l.color` (currently
   `theme.palette.text.primary`). The arrow `<tspan>` already pulls
   `l.color` for its `fill`; once the parent text adopts `l.color`, the
   number `<tspan>` inherits it.

No prop API changes; no other components touched.

## Out of scope

- The Now (live) page does not use these bubble components — it renders its
  own MUI stat layout. Color changes there are out of scope.
- Computing dominant source per period (rejected above).
- Coloring the label text under the bubble.
- Touching `flowDiagramCommon.jsx` — these are local components, not the
  shared primitives there.

## Verification

There is no test suite. Verify by:

- `cd web && npm run dev`, open the Summary page, confirm:
  - Grid bubble: blue `←` and blue kWh number on the import row; amber `→`
    and amber kWh number on the export row.
  - Battery bubble: amber `↓` and amber kWh number on the charge row;
    violet `↑` and violet kWh number on the discharge row.
- Toggle between light and dark mode — colors come from the theme palette
  so contrast should remain acceptable in both.
- `npm run lint` passes.
