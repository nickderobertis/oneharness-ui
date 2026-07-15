#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoots = ["apps/conversation-ui/src", "packages/oneharness-bridge/src"];
const extensions = new Set([".ts", ".tsx"]);
const violations = [];

const constraintSchema = z.object({
  onlyDependOnLibsWithTags: z.array(z.string().regex(/^scope:[a-z-]+$/)).min(1),
  sourceTag: z.string().regex(/^scope:[a-z-]+$/),
});
const nxConfigSchema = z.object({
  dependencyConstraints: z.array(constraintSchema).min(1),
});
const projectSchema = z.object({
  implicitDependencies: z.array(z.string().min(1)).default([]),
  name: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
});

const nxConfig = nxConfigSchema.parse(JSON.parse(await readFile(join(root, "nx.json"), "utf8")));
const constraints = new Map(
  nxConfig.dependencyConstraints.map(({ sourceTag, onlyDependOnLibsWithTags }) => [
    sourceTag,
    new Set(onlyDependOnLibsWithTags),
  ]),
);

async function projectFiles(directory) {
  return (await readdir(join(root, directory), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, directory, entry.name, "project.json"));
}

const projects = new Map();
for (const path of [...(await projectFiles("apps")), ...(await projectFiles("packages"))]) {
  const project = projectSchema.parse(JSON.parse(await readFile(path, "utf8")));
  projects.set(project.name, project);
}

for (const project of projects.values()) {
  const scopeTag = project.tags.find((tag) => tag.startsWith("scope:"));
  const allowedTags = constraints.get(scopeTag);
  if (!allowedTags) {
    violations.push(
      `${project.name}: scope tag ${scopeTag ?? "is missing"} has no dependency constraint`,
    );
    continue;
  }
  for (const dependencyName of project.implicitDependencies) {
    const dependency = projects.get(dependencyName);
    if (!dependency) {
      violations.push(`${project.name}: dependency ${dependencyName} is not a workspace project`);
      continue;
    }
    if (!dependency.tags.some((tag) => allowedTags.has(tag))) {
      violations.push(
        `${project.name}: ${scopeTag} may not depend on ${dependencyName} (${dependency.tags.join(", ")})`,
      );
    }
  }
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extensions.has(extname(path))) await inspect(path);
  }
}

async function inspect(path) {
  const content = await readFile(path, "utf8");
  const file = relative(root, path).replaceAll("\\", "/");
  const ownFeature = file.match(/src\/features\/([^/]+)/)?.[1];
  for (const match of content.matchAll(
    /(?:from\s+|import\s*)["']@\/features\/([^/'"]+)\/([^'"]+)["']/g,
  )) {
    const [, target, subpath] = match;
    if (ownFeature !== target || (ownFeature === undefined && subpath !== "index")) {
      violations.push(`${file}: import features through their public index; found ${match[0]}`);
    }
  }
  if (file.includes("/packages/") && /from\s+["'](?:@\/|apps\/)/.test(content)) {
    violations.push(`${file}: packages must not import application code`);
  }
}

for (const directory of sourceRoots) await walk(join(root, directory));
if (violations.length > 0) {
  process.stderr.write(
    `import boundary violations:\n${violations.join("\n")}\nRestore imports to the documented package direction, then rerun just lint.\n`,
  );
  process.exit(1);
}
