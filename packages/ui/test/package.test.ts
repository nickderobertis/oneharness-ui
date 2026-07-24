import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("published package", () => {
  test("installs and builds in an external React consumer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oneharness-ui-consumer-"));
    temporaryDirectories.push(directory);
    const pack = Bun.spawnSync(["npm", "pack", ".", "--pack-destination", directory], {
      cwd: "packages/ui",
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(pack.exitCode, pack.stderr.toString()).toBe(0);
    const tarball = pack.stdout.toString().trim().split("\n").at(-1);
    expect(tarball).toBeTruthy();

    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        dependencies: {
          "@oneharness/ui": `file:./${tarball}`,
          react: "^19.2.7",
          "react-dom": "^19.2.7",
        },
        devDependencies: {
          "@types/react": "^19.2.14",
          "@types/react-dom": "^19.2.3",
          typescript: "5.9.3",
        },
        private: true,
        scripts: { build: "tsc --noEmit" },
        type: "module",
      }),
    );
    await Bun.write(
      join(directory, "index.tsx"),
      `import "@oneharness/ui/styles.css";
import { Message, MessageContent, StatusBadge, type Conversation } from "@oneharness/ui";

const conversation: Conversation = {
  canContinue: false,
  harnesses: ["worker"],
  id: "session",
  name: "Session",
  project: "",
  startedAt: "2026-01-01T00:00:00Z",
  state: "completed",
  turns: [],
};

export const transcript = (
  <Message from="assistant">
    <MessageContent>{conversation.name}<StatusBadge state={conversation.state} /></MessageContent>
  </Message>
);
`,
    );
    await Bun.write(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          target: "ES2024",
        },
        include: ["index.tsx"],
      }),
    );

    const install = Bun.spawnSync(["npm", "install", "--ignore-scripts"], {
      cwd: directory,
      env: { ...process.env, npm_config_cache: join(directory, ".npm-cache") },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(install.exitCode, install.stderr.toString()).toBe(0);
    const build = Bun.spawnSync(["npm", "run", "build"], {
      cwd: directory,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (build.exitCode !== 0) {
      throw new Error(`${build.stdout.toString()}\n${build.stderr.toString()}`);
    }
  }, 180_000);
});
