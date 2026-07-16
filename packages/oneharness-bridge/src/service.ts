import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { basename, extname } from "node:path";
import {
  HistoryListSchema,
  type HistoryRecord,
  HistoryRecordsSchema,
  type HistorySessionSummary,
  OneHarness,
  RunOptionsSchema,
  RunReportSchema,
} from "@oneharness/sdk";
import {
  type BridgeRequest,
  type BridgeResponse,
  bridgeRequestSchema,
  bridgeResponseSchema,
  type Conversation,
  type ConversationSummary,
} from "@oneharness-ui/ipc-contract";
import { z } from "zod";
import type { BridgeEnvironment } from "./environment.ts";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
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
const knownRecordKeys = new Set([
  "duration_ms",
  "events",
  "exit_code",
  "failure_kind",
  "harness",
  "model",
  "name",
  "permission_mode",
  "project",
  "prompt",
  "reasoning",
  "schema_version",
  "session",
  "session_id",
  "status",
  "text",
  "text_source",
  "timestamp",
  "thinking",
  "usage",
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

function toConversation(records: HistoryRecord[]): Conversation {
  const first = records[0];
  const last = records.at(-1);
  if (!first || !last) throw new Error("history session contains no valid SDK records");
  const harnesses = [...new Set(records.map(({ harness }) => harness))];
  const state = stateFor(last.status);
  const canContinue =
    Boolean(last.session_id) && !["planned", "skipped", "spawn-error"].includes(last.status);
  return {
    canContinue,
    harnesses,
    id: first.session,
    name: first.name,
    project: first.project,
    startedAt: first.timestamp,
    state,
    turns: records.map((record, index) => {
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
        tools: (record.events ?? []).map((event) => ({
          index: event.index,
          ...(event.input !== undefined ? { input: event.input } : {}),
          kind: event.kind,
          ...(event.name !== undefined ? { name: event.name } : {}),
          ...(event.output !== undefined ? { output: event.output } : {}),
        })),
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
    }),
  };
}

function toSummary(conversation: Conversation): ConversationSummary {
  const latest = conversation.turns.at(-1);
  return {
    canContinue: conversation.canContinue,
    harnesses: conversation.harnesses,
    id: conversation.id,
    name: conversation.name,
    preview: latest?.user ?? "",
    project: conversation.project,
    startedAt: conversation.startedAt,
    state: conversation.state,
    turnCount: conversation.turns.length,
  };
}

function publicError(error: unknown): BridgeResponse {
  const detail = error instanceof Error ? error.message : String(error);
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

  async #list(): Promise<ConversationSummary[]> {
    const discovered = await invokeDiscovery(this.environment);
    const conversations = await Promise.all(
      discovered.map(async ({ id }) => toConversation(await this.#history(id))),
    );
    return conversations.map(toSummary);
  }

  async #continue(sessionId: string, message: string): Promise<Conversation> {
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
    return toConversation(await this.#history(nextId));
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
    if (!parsedRequest.success) {
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
          return { data: { conversations: await this.#list(), kind: "list" }, ok: true };
        }
        if (request.kind === "get") {
          return {
            data: {
              conversation: toConversation(await this.#history(request.sessionId)),
              kind: "get",
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
