import { readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, sep } from "node:path";
import {
  type HistoryLine,
  HistoryLineSchema,
  type HistoryRecord,
  OneHarness,
  type RunReport,
} from "@oneharness/sdk";

type EventLineVersion = Extract<HistoryLine, { type: "event" }>["schema_version"];

export type FixtureHistory = {
  historyFile: string;
  /// Serialize a record the way this run's CLI laid out its file: one line per
  /// event, stamped with the version the CLI itself wrote, then the run line.
  historyLines: (record: HistoryRecord) => string;
  record: HistoryRecord;
};

export async function readFixtureHistoryRecord(
  historyDir: string,
  report: RunReport,
): Promise<FixtureHistory> {
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
  const eventLineVersion = writtenEventLineVersion(lines);
  const records = await new OneHarness().history({
    allProjects: true,
    historyDir,
    session: basename(historyFile, extname(historyFile)),
  });
  const record = records[0];
  if (records.length !== 1 || !record) throw new Error("fixture history must contain one record");
  return {
    historyFile,
    historyLines: (written) => historyLines(written, eventLineVersion),
    record,
  };
}

/// The event-line schema version the pinned CLI stamped on this file, taken
/// from its output rather than restated here; absent when the run recorded no
/// events, in which case no synthetic event line needs one.
function writtenEventLineVersion(lines: readonly HistoryLine[]): EventLineVersion | undefined {
  const versions = new Set<EventLineVersion>();
  for (const line of lines) if (line.type === "event") versions.add(line.schema_version);
  if (versions.size > 1) {
    throw new Error("fixture history event lines disagree on their schema version");
  }
  const [version] = versions;
  return version;
}

function historyLines(
  record: HistoryRecord,
  eventLineVersion: EventLineVersion | undefined,
): string {
  const { events, ...run } = record;
  if (events?.length && eventLineVersion === undefined) {
    throw new Error("fixture record carries events but its CLI run wrote no event lines");
  }
  const lines = (events ?? []).map((event) =>
    HistoryLineSchema.parse({
      event,
      harness: record.harness,
      run_id: record.history_id,
      schema_version: eventLineVersion,
      type: "event",
    }),
  );
  lines.push(HistoryLineSchema.parse({ ...run, type: "run" }));
  return lines.map((line) => JSON.stringify(line)).join("\n");
}
