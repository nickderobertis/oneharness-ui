import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { type HistoryRecord, HistoryRecordSchema, type RunReport } from "@oneharness/sdk";

export async function readFixtureHistoryRecord(
  historyDir: string,
  report: RunReport,
): Promise<{ historyFile: string; record: HistoryRecord }> {
  if (!report.history_file) throw new Error("fixture run did not write history");
  const [historyRoot, historyFile] = await Promise.all([
    realpath(historyDir),
    realpath(report.history_file),
  ]);
  const localPath = relative(historyRoot, historyFile);
  if (
    !localPath ||
    localPath === ".." ||
    localPath.startsWith(`..${sep}`) ||
    isAbsolute(localPath)
  ) {
    throw new Error("SDK returned a history file outside the isolated fixture directory");
  }
  const lines = (await readFile(historyFile, "utf8")).trim().split("\n");
  if (lines.length !== 1 || !lines[0]) throw new Error("fixture history must contain one record");
  return { historyFile, record: HistoryRecordSchema.parse(JSON.parse(lines[0])) };
}
