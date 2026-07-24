# @oneharness/ui

Presentational React components and hooks for rendering oneharness conversation history.

```tsx
import { ConversationView } from "@oneharness/ui";
import "@oneharness/ui/styles.css";
```

The stylesheet uses Tailwind CSS v4 and includes the theme tokens, transcript markdown,
formatted JSON, and syntax-highlight styles used by the components. Add the Inter and
JetBrains Mono variable fonts in the consumer when matching the desktop app typography.

React, Radix primitives, form/markdown dependencies, and Tailwind utilities remain peer
dependencies so consumers keep one runtime copy. The exported conversation types are
structural TypeScript interfaces and do not depend on the desktop app's Zod validators.
