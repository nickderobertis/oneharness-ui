import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  type HistoryLine,
  HistoryLineSchema,
  type HistoryRecord,
  OneHarness,
  type RunOptions,
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

export type HeldRun = {
  /// Let the provider finish, then wait for the run to close. Safe to call twice.
  release: () => Promise<void>;
};

/// Start a real streamed run through the packaged CLI whose provider holds after
/// writing `before`, so history holds those events but no closing record until
/// `release` lets it write `after` and exit. `options` must name the fixture
/// provider through `bins`; only its hold and output are set here.
export async function startHeldRun(
  options: RunOptions,
  { after, before, executable }: { after: string[]; before: string[]; executable?: string },
): Promise<HeldRun> {
  const holdDir = await mkdtemp(resolve(tmpdir(), "oneharness-ui-hold-"));
  const releaseFile = resolve(holdDir, "provider-release");
  const lines = (values: string[]) => (values.length ? `${values.join("\n")}\n` : "");
  const run = (async () => {
    for await (const _ of new OneHarness(executable ? { executable } : {}).runStream({
      ...options,
      env: {
        MOCK_EXIT: "0",
        MOCK_STDERR: "",
        ...options.env,
        MOCK_RELEASE_FILE: releaseFile,
        MOCK_STDOUT: lines(before),
        MOCK_STDOUT_AFTER_RELEASE: lines(after),
      },
    })) {
      // Callers read the run through history, not through its own stream.
    }
  })();
  // `release` rethrows a failed run; this only keeps it from going unhandled first.
  run.catch(() => {});
  let released: Promise<void> | undefined;
  return {
    release: () => {
      released ??= (async () => {
        try {
          await writeFile(releaseFile, "");
          await run;
        } finally {
          await rm(holdDir, { force: true, recursive: true });
        }
      })();
      return released;
    },
  };
}
