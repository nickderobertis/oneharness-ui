# @oneharness/ui

React components and hooks for rendering oneharness conversation transcripts.

Import the package stylesheet once in your application:

```tsx
import "@oneharness/ui/styles.css";
```

The package is ESM-only. React, Radix UI, and the markdown renderer are peer
dependencies so applications retain control over their runtime versions.
The package's shadcn primitives and `cn()` helper are available from
`@oneharness/ui/primitives`.
