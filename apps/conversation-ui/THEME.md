# Conversation UI theme

The interface derives its navy neutrals and restrained spectrum accents from the oneharness
logo. The theme control defaults to the operating-system preference and persists an explicit
system, light, or dark selection. The values and storage key have one source of truth in
`src/components/theme.ts`.

## WCAG contrast verification

Ratios use WCAG 2.1 relative luminance. Text pairs meet 4.5:1 and component boundaries meet
3:1. Semantic foregrounds are paired with their matching surfaces.

| Pair | Light | Dark |
| --- | ---: | ---: |
| foreground / background | 16.66 | 16.27 |
| card foreground / card | 17.54 | 14.99 |
| popover foreground / popover | 17.54 | 13.44 |
| primary foreground / primary | 6.58 | 6.93 |
| secondary foreground / secondary | 12.02 | 11.71 |
| muted foreground / muted | 5.99 | 7.03 |
| accent foreground / accent | 11.70 | 10.40 |
| destructive / destructive surface | 5.00 | 5.81 |
| success / success surface | 4.72 | 6.23 |
| warning / warning surface | 4.98 | 6.80 |
| info / info surface | 5.11 | 5.96 |
| border / background | 4.03 | 3.70 |
| input / card | 4.24 | 3.41 |
| ring / background | 6.25 | 8.10 |
| subtle / background | 5.64 | 7.32 |
| code foreground / code | 14.79 | 15.55 |

The deterministic visual suite captures the conversation list, rich message and code content,
reply form, label dialog, and keyboard focus in both themes. Run `just visual` to reproduce the
gallery described in `docs/visual-testing.md`.
