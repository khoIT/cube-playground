# Mock revision marker

Source: `~/Downloads/cube-segment/` (local mock authored by the design team).

Captured: 2026-05-19

Files vendored (verbatim copy):
- `Cube Segment.html`
- `app.jsx`
- `components.jsx`
- `data.jsx`
- `screen-detail.jsx`
- `screen-editor.jsx`
- `screen-library.jsx`
- `screen-playground.jsx`
- `styles.css`
- `tweaks-panel.jsx`

## Purpose

This vendored mock is the **canonical source** for visual regression baselines. CI builds run against this directory (not the user's local `~/Downloads/`), giving reproducible baselines across machines.

## Updating the mock

1. Pull the latest mock from the design team into `~/Downloads/cube-segment/` (or wherever).
2. Copy the new files over the contents of this directory: `cp -R <source>/. tests/visual/mock-fork/`.
3. Update the "Captured" date above.
4. Re-run baselines: `npm run visual:capture-baselines`.
5. Review baseline diff in the PR — flag intentional design changes vs accidental drift in the PR description.
