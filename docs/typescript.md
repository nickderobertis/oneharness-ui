# TypeScript compatibility

The workspace targets TypeScript 5.9.3, the newest stable compiler supported
across the pinned Next.js, Nx, and typescript-eslint toolchain. Keep every
workspace manifest on this exact version so local, Linux, macOS, and Windows
builds exercise the same compiler.

Upgrade the compiler only after those tools support the new release, then run
the static export and browser journeys through `just check`.
