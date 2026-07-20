# Conversation UI theme

The interface derives its navy neutrals and restrained spectrum accents from the oneharness
logo. The theme control defaults to the operating-system preference and persists an explicit
system, light, or dark selection. The values and storage key have one source of truth in
`src/components/theme.ts`.

## WCAG contrast verification

The PR-ready [theme proof](docs/theme-proof/README.md#wcag-21-contrast) owns the published
contrast table. `test/theme-contrast.test.ts` recalculates every entry from `styles.css`, checks
the required WCAG threshold, and fails if the published values drift.

The deterministic visual suite captures the conversation list, rich message and code content,
reply form, label dialog, and keyboard focus in both themes. Run `just visual` to reproduce the
gallery described in `docs/visual-testing.md`.
