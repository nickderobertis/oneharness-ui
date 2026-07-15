import { expect, test } from "bun:test";
import { resolve } from "node:path";

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
      error: { code: "MALFORMED_HISTORY" },
      ok: false,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
});
