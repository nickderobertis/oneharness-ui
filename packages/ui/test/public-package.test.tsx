import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { ReplyForm, StatusBadge, TooltipProvider } from "@oneharness/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("@oneharness/ui public package", () => {
  test("renders and drives public components through the built package entry", async () => {
    const user = userEvent.setup();
    let submitted = "";
    render(
      <TooltipProvider>
        <StatusBadge state="running" />
        <ReplyForm
          error={null}
          onSubmit={async (message) => {
            submitted = message;
          }}
          pending={false}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Running")).toBeTruthy();
    await user.type(screen.getByLabelText("Continue this session"), "Continue from here");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    expect(submitted).toBe("Continue from here");
  });

  test("ships the Tailwind theme and transcript content styles", async () => {
    const css = await readFile(resolve(import.meta.dir, "../dist/styles.css"), "utf8");
    expect(css).toContain("@theme inline");
    expect(css).toContain(".message-markdown");
    expect(css).toContain(".message-json");
    expect(css).toContain(".hljs-keyword");
  });

  test("packs and resolves from a fresh external consumer", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "oneharness-ui-consumer-"));
    try {
      const packageRoot = resolve(import.meta.dir, "..");
      const packed = Bun.spawnSync(["npm", "pack", "--json", "--pack-destination", temporaryRoot], {
        cwd: packageRoot,
      });
      expect(packed.exitCode).toBe(0);
      const packOutput: unknown = JSON.parse(packed.stdout.toString());
      if (
        !Array.isArray(packOutput) ||
        packOutput.length !== 1 ||
        typeof packOutput[0] !== "object" ||
        packOutput[0] === null ||
        !("filename" in packOutput[0]) ||
        typeof packOutput[0].filename !== "string" ||
        packOutput[0].filename.length > 255 ||
        isAbsolute(packOutput[0].filename) ||
        basename(packOutput[0].filename) !== packOutput[0].filename ||
        !packOutput[0].filename.endsWith(".tgz")
      ) {
        throw new Error("npm pack returned an invalid package filename");
      }
      const filename = packOutput[0].filename;
      const consumerRoot = resolve(temporaryRoot, "consumer");
      await mkdir(consumerRoot);
      await writeFile(
        resolve(consumerRoot, "package.json"),
        `${JSON.stringify({
          dependencies: {
            "@oneharness/ui": `file:${resolve(temporaryRoot, filename)}`,
          },
          private: true,
          scripts: {
            verify:
              'bun -e \'import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { StatusBadge } from "@oneharness/ui"; const html = renderToStaticMarkup(createElement(StatusBadge, { state: "running" })); if (!html.includes("Running")) process.exit(1)\'',
          },
        })}\n`,
      );
      const install = Bun.spawnSync(["bun", "install", "--offline"], { cwd: consumerRoot });
      expect(install.exitCode).toBe(0);
      const verify = Bun.spawnSync(["bun", "run", "verify"], { cwd: consumerRoot });
      expect(verify.exitCode).toBe(0);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }, 90_000);
});
