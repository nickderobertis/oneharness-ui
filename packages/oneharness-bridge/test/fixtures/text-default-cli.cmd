@echo off
REM llmlint: ignore[boundary_inputs_validated] Test-only launcher; text-default-cli.ts bounds and validates the argv it receives, the same shape as recorded-history-watch.cmd.
bun "%~dp0text-default-cli.ts" %*
