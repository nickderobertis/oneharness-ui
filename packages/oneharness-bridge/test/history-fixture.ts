import { readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, sep } from "node:path";
import { HistoryLineSchema, type HistoryRecord, OneHarness, type RunReport } from "@oneharness/sdk";

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
  const lines = (await readFile(historyFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => HistoryLineSchema.parse(JSON.parse(line)));
  if (lines.filter((line) => line.type === "run").length !== 1) {
    throw new Error("fixture history must contain one record");
  }
  const records = await new OneHarness().history({
    allProjects: true,
    historyDir,
    session: basename(historyFile, extname(historyFile)),
  });
  const record = records[0];
  if (records.length !== 1 || !record) throw new Error("fixture history must contain one record");
  return { historyFile, record };
}
