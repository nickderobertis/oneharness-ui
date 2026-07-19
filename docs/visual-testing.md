# Web UI visual testing

The conversation UI's Playwright suite captures its real statically exported web app through the
same local bridge used by the browser journeys. Deterministic fixture sessions cover conversation
organization, rich markdown and code, formatted JSON, and the reply/continuation flow at 1280 px
desktop and 390 px phone viewports.

`just test-e2e` compares the UI with the committed images under
`apps/conversation-ui/tests/e2e/__screenshots__`. This comparison is part of `just check`. The
tests request reduced motion, remove transitions and caret rendering, use fixed viewports, and
permit only a one-percent changed-pixel ratio to absorb minor Linux rasterization differences.

For an intentional visual change, run `just screenshots`, inspect every changed desktop and mobile
image, and commit the updated baselines with the UI change. The recipe runs every browser journey so
the deterministic state leading into each capture is identical to the gate. Do not update baselines
merely to make a failing gate pass; the image difference is the contract under review.
