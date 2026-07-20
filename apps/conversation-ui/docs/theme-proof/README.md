# PR: logo-grounded light and dark conversation themes

## Summary

This change replaces the olive/lime dark-only interface with two muted, logo-derived themes.
The before captures come from commit `abbfcc5`; the after captures come from the change head.
Both sets drive the exported application through the real bridge-backed Playwright fixture.

The old application ignored the operating-system color preference, so its light-preference
captures intentionally show the same dark-only palette. The after captures demonstrate the new
persisted light and dark modes. Focus captures retain keyboard focus instead of blurring the
active control before the screenshot.

## Light theme

| View | Before | After |
| --- | --- | --- |
| Conversation list | ![Before: conversation list with light preference](before-light-conversation-list.png) | ![After: light conversation list](after-light-conversation-list.png) |
| Message and code | ![Before: message and code with light preference](before-light-message-code.png) | ![After: light message and code](after-light-message-code.png) |
| Reply form with keyboard focus | ![Before: focused reply form with light preference](before-light-reply-focus.png) | ![After: focused light reply form](after-light-reply-focus.png) |
| Label dialog | ![Before: label dialog with light preference](before-light-dialog.png) | ![After: light label dialog](after-light-dialog.png) |

## Dark theme

| View | Before | After |
| --- | --- | --- |
| Conversation list | ![Before: dark conversation list](before-dark-conversation-list.png) | ![After: dark conversation list](after-dark-conversation-list.png) |
| Message and code | ![Before: dark message and code](before-dark-message-code.png) | ![After: dark message and code](after-dark-message-code.png) |
| Reply form with keyboard focus | ![Before: focused dark reply form](before-dark-reply-focus.png) | ![After: focused dark reply form](after-dark-reply-focus.png) |
| Label dialog | ![Before: dark label dialog](before-dark-dialog.png) | ![After: dark label dialog](after-dark-dialog.png) |

## WCAG 2.1 contrast

Ratios use WCAG relative luminance. Text pairings meet or exceed 4.5:1, and component
boundaries meet or exceed 3:1. Semantic foregrounds are measured against their dedicated
surfaces.

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

## Verification

- `bun run --cwd apps/conversation-ui playwright test --config visual.playwright.config.ts`
  captures the real exported UI and bridge fixture.
- `just test-e2e` drives theme persistence and the conversation workflows through accessible
  roles, labels, and keyboard focus.
- `just gate` runs the complete deterministic pre-push gate.
