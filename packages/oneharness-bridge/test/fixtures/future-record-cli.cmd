@echo off
REM llmlint: ignore[boundary_inputs_validated] Test-only launcher; future-record-cli.ts bounds and validates the argv and the patch it receives, the same shape as text-default-cli.cmd.
bun "%~dp0future-record-cli.ts" %*
