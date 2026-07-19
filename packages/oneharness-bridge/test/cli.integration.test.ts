import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { resolve } from "node:path";
import { WEB_DEFAULT_PORT } from "../src/server.ts";

const cli = resolve(import.meta.dir, "../src/cli.ts");

test("exits after one request even while the parent keeps stdin open", async () => {
  const child = Bun.spawn([process.execPath, cli], {
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    child.stdin.write('{"kind":"unknown"}\n');
    await child.stdin.flush();
    const exitCode = await Promise.race([
      child.exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("the one-shot bridge kept waiting on parent stdin")),
          5_000,
        );
      }),
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(await new Response(child.stdout).text())).toMatchObject({
      error: { code: "INVALID_REQUEST" },
      ok: false,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
});

test("starts web mode on an explicitly validated host and port", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "oneharness-ui-web-cli-"));
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);
  await mkdir(resolve(fixture, "apps/conversation-ui/out"), { recursive: true });
  await writeFile(resolve(fixture, "apps/conversation-ui/out/index.html"), "web cli");
  const hostname = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .find(
      ({ address, family, internal }) =>
        family === "IPv4" &&
        !internal &&
        (address.startsWith("10.") ||
          address.startsWith("192.168.") ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(address)),
    )?.address;
  expect(hostname).toBeDefined();
  if (!hostname) throw new Error("test host has no private LAN IPv4 address");
  const child = Bun.spawn([process.execPath, cli, "web"], {
    cwd: fixture,
    env: {
      ...process.env,
      ONEHARNESS_UI_HOST: hostname,
      ONEHARNESS_UI_PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  try {
    const reader = child.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(first.value)).toContain(
      `oneharness UI listening on http://${hostname}:${port}`,
    );
    expect(await (await fetch(`http://${hostname}:${port}/health`)).json()).toEqual({
      status: "ok",
    });
  } finally {
    child.kill();
    await child.exited;
    await rm(fixture, { force: true, recursive: true });
  }
});

test("rejects unsafe web host and port configuration", async () => {
  for (const environment of [
    { ONEHARNESS_UI_HOST: "0.0.0.0", ONEHARNESS_UI_PORT: "4173" },
    { ONEHARNESS_UI_HOST: "127.0.0.1", ONEHARNESS_UI_PORT: "80" },
  ]) {
    const child = Bun.spawn([process.execPath, cli, "web"], {
      env: { ...process.env, ...environment },
      stderr: "pipe",
      stdout: "ignore",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toMatch(
      /private LAN IPv4|unprivileged TCP port/,
    );
  }
});

test("keeps the documented web port aligned with the server default", async () => {
  const readme = await readFile(resolve(import.meta.dir, "../../../README.md"), "utf8");
  expect(readme).toContain(`http://127.0.0.1:${WEB_DEFAULT_PORT}`);
});
