# TypeScript 7 compatibility

The publishable `@oneharness/ui` library, workspace tooling, IPC contract,
bridge, and desktop shell target TypeScript 7.0.2.

The Next.js application remains pinned to TypeScript 5.9.3. Next.js 16.2.10
does not recognize TypeScript 7 as an installed supported compiler during
`next build`; it attempts to install TypeScript with pnpm and then fails
because this is a Bun workspace. Remove this exception after Next.js supports
TypeScript 7, then verify the static export and browser journeys through
`just check`.
