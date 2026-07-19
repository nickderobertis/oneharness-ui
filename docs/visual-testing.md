# Visual testing

The conversation UI uses [screencomp](https://github.com/nickderobertis/screencomp)
for byte-reproducible visual regression testing. It captures the real exported
web UI against the deterministic SDK/CLI fixtures at desktop and phone widths.
Rendering happens only in the pinned Linux/amd64 Playwright container; the
cross-platform `just check` gate contains no pixel comparisons.

Run `just visual` with Docker available to capture the same build twice, verify
that both captures are byte-identical, and classify them against the committed
image-free manifest. Generated PNGs remain under ignored `shots/current` and
`shots/verify` directories. For an intentional visual change, review the images,
then replace the manifest with:

```sh
screencomp manifest --input shots/current --arch x86_64 \
  --output shots/baseline/x86_64.json
```

Commit only that JSON digest manifest, never baseline PNG files.

## Repository setup

The `Visual docs` workflow is a strict drift gate and also publishes the review
gallery. A maintainer must enable GitHub Pages with **Deploy from a branch** and
select the `gh-pages` branch. Make the Pages site public if inline images should
appear in pull-request comments. This strict gate does not push manifests and
uses the scoped built-in token for publishing and comments, so it does not expose
a long-lived `VISUAL_DOCS_PUSH_TOKEN` to pull-request capture code. If the project
later opts into screencomp's manifest auto-push mode, a maintainer must supply a
GitHub App or fine-grained token through a separately actor-gated publishing job;
never pass that credential to the untrusted capture job.
