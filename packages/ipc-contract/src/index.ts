import { z } from "zod";

export const bridgeRoutes = {
  health: "/health",
  invoke: "/invoke",
  session: "/session",
  watch: "/watch",
} as const;

// Both local transports reject a single frame above this ceiling before
// parsing it. The desktop drift test keeps the Rust receiver aligned.
export const maxBridgeStreamFrameBytes = 512 * 1024;

// Literal values let transport callers use the map without widening command
// names to arbitrary strings.
export const tauriBridgeCommands = {
  invoke: "invoke_bridge",
  startWatch: "start_bridge_watch",
  stopWatch: "stop_bridge_watch",
} as const;

export const sessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[\p{L}\p{N}._-]+$/u, "Invalid session identifier");

// oneharness resumes a history stream strictly after one record id, so the
// cursor the app forwards must be exactly that upstream identifier shape.
export const historyCursorSchema = z
  .string()
  .length(36)
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/u,
    "Invalid history cursor",
  );

const harnessId = z.string().min(1).max(100);
const startedAt = z.string().max(128);
export const conversationLabelMaxLength = 64;
export const conversationLabelsMaxCount = 20;
export const conversationLabelSchema = z.string().trim().min(1).max(conversationLabelMaxLength);
export const conversationLabelsSchema = z
  .array(conversationLabelSchema)
  .max(conversationLabelsMaxCount);
export const historyLabelsSchema = z.record(z.string().min(1).max(128), z.string().max(1_024));

export const conversationCursorSchema = z.object({
  sessionId: sessionIdSchema,
  startedAt,
});

export const usageSchema = z.object({
  cacheReadTokens: z.number().nonnegative().nullable().optional(),
  cacheWriteTokens: z.number().nonnegative().nullable().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
  inputTokens: z.number().nonnegative().nullable().optional(),
  outputTokens: z.number().nonnegative().nullable().optional(),
});

// Timing, status, and correlation stay optional and nullable: an upstream harness that never
// measured a boundary reports nothing, and the contract must not invent a zero for it.
export const toolEventSchema = z.object({
  durationMs: z.number().nonnegative().nullable().optional(),
  finishedAt: z.string().max(128).nullable().optional(),
  index: z.number().int().nonnegative(),
  input: z.unknown().optional(),
  kind: z.string().min(1),
  name: z.string().nullable().optional(),
  output: z.string().nullable().optional(),
  startedAt: z.string().max(128).nullable().optional(),
  status: z.string().max(64).nullable().optional(),
  timingSource: z.string().max(64).nullable().optional(),
  toolCallId: z.string().max(256).nullable().optional(),
});

export const conversationTurnSchema = z.object({
  assistant: z.string().nullable(),
  durationMs: z.number().nonnegative().nullable().optional(),
  failureKind: z.string().nullable(),
  finishedAt: z.string().max(128).nullable().optional(),
  harness: harnessId,
  id: z.string().min(1),
  model: z.string().nullable(),
  modelMs: z.number().nonnegative().nullable().optional(),
  reasoning: z.string().nullable(),
  status: z.string().min(1),
  startedAt: z.string().max(128).nullable().optional(),
  timestamp: z.string().min(1),
  timeToFirstTokenMs: z.number().nonnegative().nullable().optional(),
  toolMs: z.number().nonnegative().nullable().optional(),
  tools: z.array(toolEventSchema),
  unknown: z.record(z.string(), z.unknown()),
  usage: usageSchema,
  user: z.string(),
});

export const conversationSchema = z.object({
  canContinue: z.boolean(),
  harnesses: z.array(harnessId).max(64),
  id: sessionIdSchema,
  historyLabels: historyLabelsSchema.optional(),
  name: z.string().min(1).max(512),
  project: z.string().max(4096),
  startedAt,
  state: z.string().min(1).max(100),
  turns: z.array(conversationTurnSchema),
});

export const conversationPageSchema = conversationSchema.extend({
  nextTurnOffset: z.number().int().nonnegative().nullable(),
  totalTurnCount: z.number().int().nonnegative(),
  turns: z.array(conversationTurnSchema).max(20),
});

export const conversationSummarySchema = conversationSchema
  .pick({
    harnesses: true,
    historyLabels: true,
    id: true,
    name: true,
    project: true,
    startedAt: true,
  })
  .extend({
    labels: conversationLabelsSchema.optional(),
    turnCount: z.number().int().nonnegative(),
  });

export const bridgeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ cursor: conversationCursorSchema.optional(), kind: z.literal("list") }),
  z.object({
    kind: z.literal("get"),
    sessionId: sessionIdSchema,
    turnOffset: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("continue"),
    message: z.string().trim().min(1, "Write a message first").max(32_000),
    sessionId: sessionIdSchema,
  }),
  z.object({
    kind: z.literal("set-labels"),
    labels: conversationLabelsSchema,
    sessionId: sessionIdSchema,
  }),
  z.object({
    after: historyCursorSchema.optional(),
    kind: z.literal("watch"),
    sessionId: sessionIdSchema,
  }),
]);

export const bridgeErrorSchema = z.object({
  code: z.string().min(1),
  detail: z.string().max(16_384).optional(),
  message: z.string().min(1),
});

const successResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    conversations: z.array(conversationSummarySchema).max(25),
    kind: z.literal("list"),
    nextCursor: conversationCursorSchema.nullable(),
    totalCount: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("get"), conversation: conversationPageSchema }),
  z.object({
    kind: z.literal("continue"),
    conversation: conversationPageSchema,
    selectedSessionId: sessionIdSchema,
  }),
  z.object({
    kind: z.literal("set-labels"),
    labels: conversationLabelsSchema,
    sessionId: sessionIdSchema,
  }),
]);

export const bridgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ data: successResponseSchema, ok: z.literal(true) }),
  z.object({ error: bridgeErrorSchema, ok: z.literal(false) }),
]);

// One line of the newline-delimited watch stream. `opened` and `turn` carry the
// cursor a reconnect resumes from; a tool event names the turn it belongs to
// because the sidecar owns the upstream run-to-session join.
export const bridgeStreamFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    cursor: historyCursorSchema.nullable(),
    kind: z.literal("opened"),
    sessionId: sessionIdSchema,
    totalTurnCount: z.number().int().nonnegative(),
  }),
  z.object({
    cursor: historyCursorSchema,
    kind: z.literal("turn"),
    turn: conversationTurnSchema,
  }),
  z.object({
    kind: z.literal("tool-event"),
    tool: toolEventSchema,
    turnId: z.string().min(1),
  }),
  z.object({ error: bridgeErrorSchema, kind: z.literal("error") }),
]);

export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export type BridgeStreamFrame = z.infer<typeof bridgeStreamFrameSchema>;
export type BridgeWatchRequest = Extract<BridgeRequest, { kind: "watch" }>;
export type BridgeResponse = z.infer<typeof bridgeResponseSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationCursor = z.infer<typeof conversationCursorSchema>;
export type ConversationPage = z.infer<typeof conversationPageSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationToolEvent = z.infer<typeof toolEventSchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
