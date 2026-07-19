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
appear in pull-request comments. Add a `VISUAL_DOCS_PUSH_TOKEN` Actions secret
containing a fine-grained PAT or GitHub App token with repository Contents and
Pull requests write access when branch protection requires token-triggered
workflow runs. The built-in token still runs the reproducibility and drift gate;
the extra secret is for reliable publishing and comments under protected-branch
rules.
