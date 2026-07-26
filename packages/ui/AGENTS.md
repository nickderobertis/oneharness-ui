# Public UI library rules

- Keep the package presentational and independent of the local bridge and IPC validators.
- Public types must not expose application-only or validation-runtime dependencies.
- Preserve `"use client"` directives and treat the package exports and CSS entry as public API.
