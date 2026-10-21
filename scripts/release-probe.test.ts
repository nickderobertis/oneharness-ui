import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("declared npm target probes registry truth and distinguishes absent from unanswered", async () => {
  const declaration = Bun.TOML.parse(await readFile("release-targets.toml", "utf8"));
  expect(declaration.schema_version).toBe(1);
  expect(declaration.target).toHaveLength(1);
  const target = declaration.target[0];
  expect(target.id).toBe("npm:@oneharness/ui");
  expect(target.name).toBe("npm");
  expect(JSON.parse(await readFile(target.manifest, "utf8")).name).toBe("@oneharness/ui");
  expect(await readFile(".github/workflows/check.yml", "utf8")).toContain(
    "Compute, tag, and publish release",
  );
  let status = 200;
  let body = '{"version":"1.2.3"}';
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      paths.push(new URL(request.url).pathname);
      return new Response(body, { status });
    },
  });
  async function probe(id = target.id) {
    const child = Bun.spawn(["node", declaration.probe, id], {
      env: { ...process.env, NPM_CONFIG_REGISTRY: server.url.toString() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stderr, stdout };
  }
  try {
    expect(await probe()).toEqual({ code: 0, stderr: "", stdout: "1.2.3\n" });
    expect(paths).toEqual(["/@oneharness%2Fui/latest"]);
    status = 404;
    expect(await probe()).toEqual({ code: 0, stderr: "", stdout: "" });
    status = 503;
    expect((await probe()).code).toBe(1);
    status = 200;
    body = '{"version":"bad\\nversion"}';
    expect((await probe()).code).toBe(1);
    body = "not json";
    expect((await probe()).code).toBe(1);
    expect((await probe("npm:other")).code).toBe(1);
    body = '{"version":"1.2.4"}';
    expect(await probe()).toEqual({ code: 0, stderr: "", stdout: "1.2.4\n" });
    server.stop(true);
    const unreachable = await probe();
    expect(unreachable.code).toBe(1);
    expect(unreachable.stdout).toBe("");
    expect(unreachable.stderr).toContain("Check the target and registry");
  } finally {
    server.stop(true);
  }
});
