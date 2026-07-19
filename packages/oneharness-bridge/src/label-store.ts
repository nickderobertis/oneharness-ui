import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  conversationLabelSchema,
  conversationLabelsSchema,
  sessionIdSchema,
} from "@oneharness-ui/ipc-contract";
import { z } from "zod";
import type { BridgeEnvironment } from "./environment.ts";

const MAX_STORE_BYTES = 256 * 1024;
export const labelStoreSchema = z.object({
  labels: z.record(sessionIdSchema, conversationLabelsSchema),
  schemaVersion: z.literal(1),
});
type LabelStore = z.infer<typeof labelStoreSchema>;

function storePath(environment: BridgeEnvironment): string {
  const base = environment.historyDir ?? environment.labelDir;
  if (!base) throw new Error("conversation label storage directory is unavailable");
  return join(base, ".oneharness-ui-labels.json");
}

async function readStore(path: string): Promise<LabelStore> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("label storage is not a regular file");
    if (stat.size > MAX_STORE_BYTES) throw new Error("label storage is too large");
    const value = await readFile(path, "utf8");
    return labelStoreSchema.parse(JSON.parse(value));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { labels: {}, schemaVersion: 1 };
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`conversation label storage is malformed: ${detail}`, { cause: error });
  }
}

export async function labelsFor(environment: BridgeEnvironment): Promise<LabelStore["labels"]> {
  return (await readStore(storePath(environment))).labels;
}

export async function setLabels(
  environment: BridgeEnvironment,
  sessionId: string,
  input: string[],
): Promise<string[]> {
  const labels = [...new Set(input.map((label) => conversationLabelSchema.parse(label)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const path = storePath(environment);
  const store = await readStore(path);
  if (labels.length === 0) delete store.labels[sessionId];
  else store.labels[sessionId] = labels;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return labels;
}
