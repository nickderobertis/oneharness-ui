#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const requestedRoot = process.argv[2];
if (requestedRoot !== undefined && !isAbsolute(requestedRoot)) {
  throw new Error("version drift root must be absolute; pass an absolute fixture path");
}
const root = requestedRoot ?? resolve(import.meta.dirname, "..");
const read = (path) => {
  try {
    return readFileSync(resolve(root, path), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not read ${path}: ${detail}; restore the required file and rerun just check`,
    );
  }
};
const readJson = (path) => {
  try {
    return JSON.parse(read(path));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("could not read ")) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${path} must contain valid JSON: ${detail}; fix the manifest and rerun just check`,
    );
  }
};
const versions = Object.fromEntries(
  read(".tool-versions")
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/, 2)),
);
const requiredTools = ["bun", "nodejs", "just", "uv"];
for (const tool of requiredTools) {
  if (!versions[tool]) {
    throw new Error(`.tool-versions is missing ${tool}; add its stable pinned version`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(versions[tool])) {
    throw new Error(
      `.tool-versions ${tool} must be an exact stable version; replace it with an X.Y.Z pin`,
    );
  }
}

const workflowDirectory = resolve(root, ".github/workflows");
let workflowEntries;
try {
  workflowEntries = readdirSync(workflowDirectory, { withFileTypes: true });
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `could not read .github/workflows: ${detail}; restore the workflow directory and rerun just check`,
  );
}
for (const entry of workflowEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
  const workflow = read(`.github/workflows/${entry.name}`);
  const expectations = [
    ["actions/setup-node@", `node-version: ${versions.nodejs}`],
    ["oven-sh/setup-bun@", `bun-version: ${versions.bun}`],
    ["astral-sh/setup-uv@", `version: ${versions.uv}`],
    ["cargo install just", `cargo install just --locked --version ${versions.just}`],
  ];
  for (const [marker, expected] of expectations) {
    if (workflow.includes(marker) && !workflow.includes(expected)) {
      throw new Error(
        `${entry.name} must use ${expected} from .tool-versions; update both files together`,
      );
    }
  }
}

const bridgeManifest = readJson("packages/oneharness-bridge/package.json");
const desktopManifest = readJson("apps/desktop-shell/package.json");
const rootManifest = readJson("package.json");
const typescriptVersion = rootManifest.devDependencies?.typescript;
const typescriptManifests = [
  ["apps/conversation-ui/package.json", readJson("apps/conversation-ui/package.json")],
  ["apps/conversation-ui-e2e/package.json", readJson("apps/conversation-ui-e2e/package.json")],
  ["apps/desktop-shell/package.json", desktopManifest],
  ["apps/desktop-shell-e2e/package.json", readJson("apps/desktop-shell-e2e/package.json")],
  ["packages/browser-test-env/package.json", readJson("packages/browser-test-env/package.json")],
  ["packages/ipc-contract/package.json", readJson("packages/ipc-contract/package.json")],
  ["packages/oneharness-bridge/package.json", bridgeManifest],
  ["packages/ui/package.json", readJson("packages/ui/package.json")],
];
if (typeof typescriptVersion !== "string") {
  throw new Error("root package.json must pin TypeScript; add its stable pinned version");
}
for (const [path, manifest] of typescriptManifests) {
  if (manifest.devDependencies?.typescript !== typescriptVersion) {
    throw new Error(
      `${path} TypeScript pin must match root package.json; update both manifests together`,
    );
  }
}
const sdkVersion = bridgeManifest.dependencies?.["@oneharness/sdk"];
if (
  typeof sdkVersion !== "string" ||
  desktopManifest.devDependencies?.["@oneharness/sdk"] !== sdkVersion
) {
  throw new Error(
    "desktop and bridge @oneharness/sdk pins must match; update both manifests together",
  );
}
const compatibleBuild = read("scripts/build-compatible-cli.sh");
if (!compatibleBuild.includes(`readonly UPSTREAM_VERSION="${sdkVersion}"`)) {
  throw new Error(
    "build-compatible-cli.sh UPSTREAM_VERSION must match @oneharness/sdk; update its pinned revision and version",
  );
}
const sdkDocumentation = [
  ["README.md", `oneharness ${sdkVersion} CLI`, `@oneharness/sdk\` package to \`${sdkVersion}`],
  ["docs/native-desktop-e2e.md", `oneharness ${sdkVersion} CLI`],
];
for (const [path, ...expectedValues] of sdkDocumentation) {
  const documentation = read(path);
  for (const expected of expectedValues) {
    if (!documentation.includes(expected)) {
      throw new Error(
        `${path} must document @oneharness/sdk ${sdkVersion}; update the package pins and documentation together`,
      );
    }
  }
}

// The browser journey projects are the one source for which engines this
// repository supports: bootstrap provisions exactly them, and the documentation
// names exactly them.
const browserJourneyConfig = "apps/conversation-ui-e2e/playwright.config.ts";
const declaredProjects = /\n {2}projects: \[\n(?<projects>.*?)\n {2}\],\n/s.exec(
  read(browserJourneyConfig),
)?.groups?.projects;
if (declaredProjects === undefined) {
  throw new Error(
    `${browserJourneyConfig} must list its browser projects one per line; restore that list and rerun just check`,
  );
}
const browserEngines = [...declaredProjects.matchAll(/name: "(?<engine>[a-z-]+)"/g)].map(
  (match) => match.groups.engine,
);
if (browserEngines.length === 0) {
  throw new Error(
    `${browserJourneyConfig} must declare at least one browser project; restore its projects list`,
  );
}
// Projects inside the Windows guard's non-Windows branch run everywhere but
// Windows, so only this exact guard shape is accepted: reversed branches would
// swap the matrix while the project names stayed the same.
const windowsGuard = '...(process.platform === "win32" ? [] : [';
const projectsText = declaredProjects.replace(/\s+/g, " ");
const windowsGuardAt = projectsText.indexOf(windowsGuard);
const win32Mentions = projectsText.split("win32").length - 1;
if (
  windowsGuardAt === -1
    ? win32Mentions !== 0
    : win32Mentions !== 1 || !/\]\),?$/.test(projectsText.trimEnd())
) {
  throw new Error(
    `${browserJourneyConfig} must exclude Windows browser projects with one trailing \`${windowsGuard}...])\` guard; restore that shape`,
  );
}
const windowsEngines = [
  ...(windowsGuardAt === -1 ? projectsText : projectsText.slice(0, windowsGuardAt)).matchAll(
    /name: "(?<engine>[a-z-]+)"/g,
  ),
].map((match) => match.groups.engine);
if (windowsEngines.length === 0) {
  throw new Error(
    `${browserJourneyConfig} must declare at least one browser project for Windows; restore its projects list`,
  );
}
const bootstrap = read("scripts/bootstrap.sh");
for (const [platform, line] of [
  ["Linux", `  Linux) install_playwright_browsers --with-deps ${browserEngines.join(" ")} ;;`],
  [
    "Windows",
    `  MINGW* | MSYS* | CYGWIN*) install_playwright_browsers ${windowsEngines.join(" ")} ;;`,
  ],
  ["other platforms", `  *) install_playwright_browsers ${browserEngines.join(" ")} ;;`],
]) {
  if (!bootstrap.split("\n").includes(line)) {
    throw new Error(
      `bootstrap.sh must provision exactly the ${browserJourneyConfig} engines on ${platform} with "${line.trim()}"; update both files together`,
    );
  }
}
const engineNames = { chromium: "Chromium", webkit: "WebKit" };
function documentEngines(engines) {
  return new Intl.ListFormat("en").format(
    engines.map((engine) => {
      const name = engineNames[engine];
      if (!name) {
        throw new Error(
          `${engine} has no documented engine name; name it in check-version-drift.mjs and the browser journey documentation`,
        );
      }
      return name;
    }),
  );
}
const documentedEngines = documentEngines(browserEngines);
const windowsException =
  windowsEngines.length === browserEngines.length
    ? undefined
    : `${documentEngines(windowsEngines)} alone on Windows`;
for (const path of ["README.md", "docs/architecture.md"]) {
  const documentation = read(path).replace(/\s+/g, " ");
  if (!documentation.includes(documentedEngines)) {
    throw new Error(
      `${path} must document the ${documentedEngines} browser journeys; update the projects and documentation together`,
    );
  }
  if (windowsException === undefined && documentation.includes("alone on Windows")) {
    throw new Error(
      `${path} documents a Windows browser exception that ${browserJourneyConfig} no longer makes; update the projects and documentation together`,
    );
  }
  if (windowsException !== undefined && !documentation.includes(windowsException)) {
    throw new Error(
      `${path} must document the browser journeys running in ${windowsException}; update the projects and documentation together`,
    );
  }
}
