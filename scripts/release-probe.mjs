#!/usr/bin/env node

/** Registry truth: one version, empty for unpublished, nonzero for unanswered. */
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "npm:@oneharness/ui") {
    throw new Error("pass exactly the declared target npm:@oneharness/ui");
  }
  const registry = process.env.NPM_CONFIG_REGISTRY ?? "https://registry.npmjs.org";
  const url = new URL(`${registry.replace(/\/$/, "")}/@oneharness%2Fui/latest`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("NPM_CONFIG_REGISTRY must be an HTTP(S) registry URL without credentials");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
  const body = await response.json();
  if (
    typeof body?.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(body.version)
  ) {
    throw new Error("registry response has no valid version");
  }
  console.log(body.version);
}

main().catch((error) => {
  console.error(`release-probe: ${error.message}. Check the target and registry, then retry.`);
  process.exitCode = 1;
});
