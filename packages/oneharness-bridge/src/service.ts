import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { basename, extname } from "node:path";
import {
  type ActionEvent,
  HistoryListSchema,
  type HistoryRecord,
  HistoryRecordSchema,
  HistoryRecordsSchema,
  type HistorySessionSummary,
  HistoryStreamEnvelopeSchema,
  OneHarness,
  RunOptionsSchema,
  RunReportSchema,
} from "@oneharness/sdk";
import {
  type BridgeRequest,
  type BridgeResponse,
  type BridgeStreamFrame,
  bridgeRequestSchema,
  bridgeResponseSchema,
  bridgeStreamFrameSchema,
  type ConversationCursor,
  type ConversationPage,
  type ConversationSummary,
  type ConversationTurn,
} from "@oneharness-ui/ipc-contract";
import { z } from "zod";
import type { BridgeEnvironment } from "./environment.ts";
import { labelsFor, setLabels } from "./label-store.ts";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const CONVERSATION_LIST_PAGE_SIZE = 25;
const CONVERSATION_TURN_PAGE_SIZE = 20;
export const MAX_CONVERSATION_PAGE_BYTES = 512 * 1024;
const MAX_ERROR_DETAIL_CHARACTERS = 16_384;
// A watched conversation only ever needs the runs oneharness has not closed
// yet, so the unresolved-event buffer stays small and self-trimming.
export const MAX_PENDING_WATCH_RUNS = 32;
export const MAX_PENDING_WATCH_EVENTS = 256;
export const authorizationSchema = z.string().min(32).max(256);
const environmentValueSchema = z.string().max(32_768);
const CLI_ENVIRONMENT_KEYS = [
  "APPDATA",
  "HOME",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "ONEHARNESS_CONFIG",
  "ONEHARNESS_NO_CONFIG",
  "PATH",
  "PATHEXT",
  "Path",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
] as const;
type HistoryRecordJsonSchema = {
  anyOf?: Array<{ properties?: Record<string, unknown> }>;
};
const historyRecordJsonSchema = HistoryRecordSchema.toJSONSchema() as HistoryRecordJsonSchema;
const knownRecordKeys = new Set([
  ...(historyRecordJsonSchema.anyOf ?? []).flatMap((variant) =>
    Object.keys(variant.properties ?? {}),
  ),
  // Legacy SDK records may carry either alias outside the current schema.
  "reasoning",
  "thinking",
]);

type Executable = { command: string; prefix: string[] };

function discoveryEnvironment(
  input: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CLI_ENVIRONMENT_KEYS) {
    const value = input[key];
    if (value !== undefined) environment[key] = environmentValueSchema.parse(value);
  }
  return environment;
}

function resolveExecutable(environment: BridgeEnvironment): Executable {
  if (environment.executable) return { command: environment.executable, prefix: [] };
  const sdkRequire = createRequire(import.meta.resolve("@oneharness/sdk"));
  return {
    command: process.execPath,
    prefix: [sdkRequire.resolve("oneharness-cli/bin/oneharness.js")],
  };
}

async function invokeDiscovery(environment: BridgeEnvironment): Promise<HistorySessionSummary[]> {
  const executable = resolveExecutable(environment);
  const args = [...executable.prefix, "history", "list", "--compact", "--all-projects"];
  if (environment.historyDir) args.push("--history-dir", environment.historyDir);
  return await new Promise((resolve, reject) => {
    const child = spawn(executable.command, args, {
      env: discoveryEnvironment(process.env),
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const append = (target: "stdout" | "stderr", chunk: string) => {
      if (stdout.length + stderr.length + chunk.length > MAX_OUTPUT_BYTES) {
        child.kill();
        reject(new Error("oneharness history output exceeded the safe size limit"));
        return;
      }
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => append("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => append("stderr", chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`oneharness history discovery exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(HistoryListSchema.parse(JSON.parse(stdout)));
      } catch {
        reject(new Error("oneharness history discovery returned malformed JSON"));
      }
    });
  });
}

function stateFor(status: string): string {
  if (status === "ok") return "completed";
  if (status === "nonzero" || status === "spawn-error") return "failed";
  if (status === "timeout" || status === "skipped" || status === "planned") return "stopped";
  return status;
}

function optionalNumber(value: number | null | undefined): number | null | undefined {
  return value;
}

function reasoningFrom(record: HistoryRecord): string | null {
  const source = record as HistoryRecord & Record<string, unknown>;
  for (const key of ["reasoning", "thinking"] as const) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (value !== undefined && value !== null) return JSON.stringify(value, null, 2);
  }
  return null;
}

/// The shared shape every history event variant exposes, so one mapper covers
/// both a closing record's events and a streamed event line.
type NormalizedHistoryEvent = {
  index: number;
  input?: unknown;
  kind: string;
  name?: string | null | undefined;
  output?: string | null | undefined;
};

function toToolEvent(event: NormalizedHistoryEvent): ConversationTurn["tools"][number] {
  return {
    index: event.index,
    ...(event.input !== undefined ? { input: event.input } : {}),
    kind: event.kind,
    ...(event.name !== undefined ? { name: event.name } : {}),
    ...(event.output !== undefined ? { output: event.output } : {}),
  };
}

function toTurn(record: HistoryRecord, index: number): ConversationTurn {
  const unknown = Object.fromEntries(
    Object.entries(record).filter(([key]) => !knownRecordKeys.has(key)),
  );
  return {
    assistant: record.text ?? null,
    failureKind: record.failure_kind ?? null,
    harness: record.harness,
    id: `${record.session}-${index}`,
    model: record.model ?? null,
    reasoning: reasoningFrom(record),
    status: stateFor(record.status),
    timestamp: record.timestamp,
    tools: (record.events ?? []).map(toToolEvent),
    unknown,
    usage: {
      ...(record.usage.cache_read_tokens !== undefined
        ? { cacheReadTokens: optionalNumber(record.usage.cache_read_tokens) }
        : {}),
      ...(record.usage.cache_write_tokens !== undefined
        ? { cacheWriteTokens: optionalNumber(record.usage.cache_write_tokens) }
        : {}),
      ...(record.usage.cost_usd !== undefined
        ? { costUsd: optionalNumber(record.usage.cost_usd) }
        : {}),
      ...(record.usage.input_tokens !== undefined
        ? { inputTokens: optionalNumber(record.usage.input_tokens) }
        : {}),
      ...(record.usage.output_tokens !== undefined
        ? { outputTokens: optionalNumber(record.usage.output_tokens) }
        : {}),
    },
    user: record.prompt,
  };
}

function toConversationPage(records: HistoryRecord[], requestedOffset = 0): ConversationPage {
  const first = records[0];
  const last = records.at(-1);
  if (!first || !last) throw new Error("history session contains no valid SDK records");
  if (requestedOffset >= records.length && requestedOffset !== 0) {
    throw new Error("conversation turn offset is outside the history session");
  }
  const harnesses = [...new Set(records.map(({ harness }) => harness))];
  const state = stateFor(last.status);
  const canContinue =
    Boolean(last.session_id) && !["planned", "skipped", "spawn-error"].includes(last.status);
  const conversation: ConversationPage = {
    canContinue,
    harnesses,
    ...(first.labels && Object.keys(first.labels).length > 0
      ? { historyLabels: first.labels }
      : {}),
    id: first.session,
    name: first.name,
    project: first.project,
    startedAt: first.timestamp,
    state,
    turns: [],
    nextTurnOffset: null,
    totalTurnCount: records.length,
  };
  for (
    let index = requestedOffset;
    index < records.length && index < requestedOffset + CONVERSATION_TURN_PAGE_SIZE;
    index += 1
  ) {
    const record = records[index];
    if (!record) break;
    const turn = toTurn(record, index);
    const candidate = { ...conversation, turns: [...conversation.turns, turn] };
    const exceedsPageBudget =
      Buffer.byteLength(JSON.stringify(candidate)) > MAX_CONVERSATION_PAGE_BYTES;
    if (exceedsPageBudget && conversation.turns.length > 0) break;
    // HistoryRecordsSchema validates persisted IO before this soft multi-turn budget is applied.
    // A single validated turn remains intact and loadable even when it exceeds the budget alone.
    conversation.turns.push(turn);
    if (exceedsPageBudget) break;
  }
  const nextOffset = requestedOffset + conversation.turns.length;
  conversation.nextTurnOffset = nextOffset < records.length ? nextOffset : null;
  return conversation;
}

function toSummary(summary: HistorySessionSummary, labels: string[]): ConversationSummary {
  return {
    harnesses: summary.harnesses,
    ...(summary.labels && Object.keys(summary.labels).length > 0
      ? { historyLabels: summary.labels }
      : {}),
    id: summary.id,
    ...(labels.length > 0 ? { labels } : {}),
    name: summary.name,
    project: summary.project,
    startedAt: summary.started,
    turnCount: summary.record_count,
  };
}

function summaryOrder(left: HistorySessionSummary, right: HistorySessionSummary): number {
  return right.started.localeCompare(left.started) || right.id.localeCompare(left.id);
}

function followsCursor(summary: HistorySessionSummary, cursor: ConversationCursor): boolean {
  return (
    summary.started < cursor.startedAt ||
    (summary.started === cursor.startedAt && summary.id < cursor.sessionId)
  );
}

function publicError(error: unknown): BridgeResponse {
  const detail = (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_ERROR_DETAIL_CHARACTERS,
  );
  if (/ENOENT|not found|cannot find|spawn/i.test(detail)) {
    return {
      error: {
        code: "EXECUTABLE_NOT_FOUND",
        detail,
        message:
          "oneharness could not be started. Reinstall the app or set ONEHARNESS_BIN to a valid executable.",
      },
      ok: false,
    };
  }
  if (/config|toml/i.test(detail)) {
    return {
      error: {
        code: "CONFIG_ERROR",
        detail,
        message: "oneharness configuration could not be loaded. Check the reported config path.",
      },
      ok: false,
    };
  }
  if (/invalid|malformed|valid SDK records|contract/i.test(detail)) {
    return {
      error: {
        code: "MALFORMED_HISTORY",
        detail,
        message: "A history session is malformed or uses an unsupported contract version.",
      },
      ok: false,
    };
  }
  return {
    error: {
      code: "ONEHARNESS_ERROR",
      detail,
      message: "oneharness could not complete the request. Review the detail and try again.",
    },
    ok: false,
  };
}

function errorFrame(error: Extract<BridgeResponse, { ok: false }>["error"]): BridgeStreamFrame {
  return bridgeStreamFrameSchema.parse({ error, kind: "error" });
}

function bufferPendingEvent(
  pending: Map<string, ActionEvent[]>,
  runId: string,
  event: ActionEvent,
): void {
  const buffered = pending.get(runId) ?? [];
  if (buffered.length >= MAX_PENDING_WATCH_EVENTS) buffered.shift();
  buffered.push(event);
  pending.set(runId, buffered);
  for (const oldest of pending.keys()) {
    if (pending.size <= MAX_PENDING_WATCH_RUNS) break;
    pending.delete(oldest);
  }
}

export class BridgeService {
  readonly #client: OneHarness;
  readonly #expectedAuthorization: Buffer;

  constructor(
    readonly environment: BridgeEnvironment,
    expectedAuthorization: string,
  ) {
    this.#expectedAuthorization = Buffer.from(authorizationSchema.parse(expectedAuthorization));
    this.#client = new OneHarness({
      env: { ONEHARNESS_RUN_MODE: "parallel" },
      ...(environment.executable ? { executable: environment.executable } : {}),
    });
  }

  isAuthorized(presentedAuthorization: unknown): presentedAuthorization is string {
    const parsed = authorizationSchema.safeParse(presentedAuthorization);
    if (!parsed.success) return false;
    const presented = Buffer.from(parsed.data);
    return (
      presented.length === this.#expectedAuthorization.length &&
      timingSafeEqual(presented, this.#expectedAuthorization)
    );
  }

  async #history(session: string): Promise<HistoryRecord[]> {
    return HistoryRecordsSchema.parse(
      await this.#client.history({
        allProjects: true,
        ...(this.environment.historyDir ? { historyDir: this.environment.historyDir } : {}),
        session,
      }),
    );
  }

  async #list(cursor?: ConversationCursor): Promise<{
    conversations: ConversationSummary[];
    nextCursor: ConversationCursor | null;
    totalCount: number;
  }> {
    const [discovered, storedLabels] = await Promise.all([
      invokeDiscovery(this.environment).then((summaries) => summaries.sort(summaryOrder)),
      labelsFor(this.environment),
    ]);
    const remaining = cursor
      ? discovered.filter((summary) => followsCursor(summary, cursor))
      : discovered;
    const page = remaining.slice(0, CONVERSATION_LIST_PAGE_SIZE);
    const last = page.at(-1);
    return {
      conversations: page.map((summary) => toSummary(summary, storedLabels[summary.id] ?? [])),
      nextCursor:
        remaining.length > page.length && last
          ? { sessionId: last.id, startedAt: last.started }
          : null,
      totalCount: discovered.length,
    };
  }

  async #continue(sessionId: string, message: string): Promise<ConversationPage> {
    const current = await this.#history(sessionId);
    const latest = current.at(-1);
    if (!latest?.session_id || ["planned", "skipped", "spawn-error"].includes(latest.status)) {
      throw new Error("the selected conversation has no eligible native continuation session");
    }
    const options = RunOptionsSchema.parse({
      cwd: latest.project,
      events: true,
      harnesses: [latest.harness],
      history: true,
      historyName: latest.name,
      ...(latest.labels && Object.keys(latest.labels).length > 0
        ? { historyLabels: latest.labels }
        : {}),
      mode: latest.permission_mode,
      prompt: message,
      resume: latest.session_id,
      ...(this.environment.historyDir ? { historyDir: this.environment.historyDir } : {}),
      ...(this.environment.providerBin
        ? {
            bins: {
              [this.environment.providerHarness ?? latest.harness]: this.environment.providerBin,
            },
          }
        : {}),
    });
    const report = RunReportSchema.parse(await this.#client.run(options));
    if (!report.history_file) throw new Error("continued run did not create a history session");
    const filename = basename(report.history_file);
    const nextId = filename.slice(0, filename.length - extname(filename).length);
    return toConversationPage(await this.#history(nextId));
  }

  /// Follow one conversation as oneharness records it. History event lines
  /// correlate by `run_id` only, so unresolved events wait in a bounded buffer
  /// until the closing record names the session they belong to; events for a
  /// run already known to be part of this conversation stream straight through.
  async *watch(
    input: unknown,
    presentedAuthorization: unknown,
    signal?: AbortSignal,
  ): AsyncGenerator<BridgeStreamFrame> {
    if (!this.isAuthorized(presentedAuthorization)) {
      yield errorFrame({ code: "UNAUTHORIZED", message: "Local bridge authorization failed." });
      return;
    }
    const parsedRequest = bridgeRequestSchema.safeParse(input);
    if (!parsedRequest.success || parsedRequest.data.kind !== "watch") {
      yield errorFrame({
        code: "INVALID_REQUEST",
        message: "The local bridge watch request is invalid.",
      });
      return;
    }
    const request = parsedRequest.data;
    const turnIndexes = new Map<string, number>();
    const pendingEvents = new Map<string, ActionEvent[]>();
    let turnCount = 0;
    let cursor = request.after;
    try {
      const existing = await this.#history(request.sessionId);
      for (const [index, record] of existing.entries()) {
        turnIndexes.set(record.history_id, index);
      }
      turnCount = existing.length;
      cursor ??= existing.at(-1)?.history_id;
      yield bridgeStreamFrameSchema.parse({
        cursor: cursor ?? null,
        kind: "opened",
        sessionId: request.sessionId,
        totalTurnCount: turnCount,
      });
      const envelopes = this.#client.historyWatch({
        allProjects: true,
        ...(cursor ? { after: cursor } : {}),
        events: true,
        ...(this.environment.historyDir ? { historyDir: this.environment.historyDir } : {}),
      });
      // Iterate by hand so closing this stream never waits on the upstream
      // watcher's own teardown; a caller that stops reading must return at once.
      try {
        while (!signal?.aborted) {
          const next = await envelopes.next();
          if (next.done) break;
          const envelope = HistoryStreamEnvelopeSchema.parse(next.value);
          if (envelope.type === "event") {
            const frame = this.#toolEventFrame(request.sessionId, envelope.line, turnIndexes);
            if (frame) yield frame;
            else bufferPendingEvent(pendingEvents, envelope.line.run_id, envelope.line.event);
            continue;
          }
          const record = envelope.record;
          const joined = pendingEvents.get(record.history_id) ?? [];
          pendingEvents.delete(record.history_id);
          if (record.session !== request.sessionId) continue;
          const index = turnIndexes.get(record.history_id) ?? turnCount;
          if (!turnIndexes.has(record.history_id)) {
            turnIndexes.set(record.history_id, index);
            turnCount += 1;
          }
          yield bridgeStreamFrameSchema.parse({
            cursor: record.history_id,
            kind: "turn",
            turn: toTurn(
              HistoryRecordSchema.parse({
                ...record,
                events: [...(record.events ?? []), ...joined],
              }),
              index,
            ),
          });
        }
      } finally {
        // The upstream watcher owns its own teardown; a failure there is not
        // the reader's to await or report.
        void envelopes.return(undefined).catch(() => {});
      }
    } catch (error) {
      if (signal?.aborted) return;
      const response = publicError(error);
      if (!response.ok) yield errorFrame(response.error);
    }
  }

  #toolEventFrame(
    sessionId: string,
    line: { event: ActionEvent; run_id: string },
    turnIndexes: ReadonlyMap<string, number>,
  ): BridgeStreamFrame | undefined {
    const index = turnIndexes.get(line.run_id);
    if (index === undefined) return undefined;
    return bridgeStreamFrameSchema.parse({
      kind: "tool-event",
      tool: toToolEvent(line.event),
      turnId: `${sessionId}-${index}`,
    });
  }

  async handle(input: unknown, presentedAuthorization: unknown): Promise<BridgeResponse> {
    if (!this.isAuthorized(presentedAuthorization)) {
      return bridgeResponseSchema.parse({
        error: {
          code: "UNAUTHORIZED",
          message: "Local bridge authorization failed.",
        },
        ok: false,
      });
    }
    const parsedRequest = bridgeRequestSchema.safeParse(input);
    // A watch is only answerable over the newline-delimited stream transport.
    if (!parsedRequest.success || parsedRequest.data.kind === "watch") {
      return bridgeResponseSchema.parse({
        error: {
          code: "INVALID_REQUEST",
          message: "The local bridge request is invalid.",
        },
        ok: false,
      });
    }
    try {
      const request: BridgeRequest = parsedRequest.data;
      const response: BridgeResponse = await (async () => {
        if (request.kind === "list") {
          return { data: { ...(await this.#list(request.cursor)), kind: "list" }, ok: true };
        }
        if (request.kind === "get") {
          return {
            data: {
              conversation: toConversationPage(
                await this.#history(request.sessionId),
                request.turnOffset,
              ),
              kind: "get",
            },
            ok: true,
          };
        }
        if (request.kind === "set-labels") {
          await this.#history(request.sessionId);
          return {
            data: {
              kind: "set-labels",
              labels: await setLabels(this.environment, request.sessionId, request.labels),
              sessionId: request.sessionId,
            },
            ok: true,
          };
        }
        const conversation = await this.#continue(request.sessionId, request.message);
        return {
          data: {
            conversation,
            kind: "continue",
            selectedSessionId: conversation.id,
          },
          ok: true,
        };
      })();
      return bridgeResponseSchema.parse(response);
    } catch (error) {
      return bridgeResponseSchema.parse(publicError(error));
    }
  }
}
