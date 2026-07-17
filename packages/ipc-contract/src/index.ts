import { z } from "zod";

const sessionId = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[\p{L}\p{N}._-]+$/u, "Invalid session identifier");

const harnessId = z.string().min(1).max(100);
const startedAt = z.string().max(128);

export const conversationCursorSchema = z.object({
  sessionId,
  startedAt,
});

export const usageSchema = z.object({
  cacheReadTokens: z.number().nonnegative().nullable().optional(),
  cacheWriteTokens: z.number().nonnegative().nullable().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
  inputTokens: z.number().nonnegative().nullable().optional(),
  outputTokens: z.number().nonnegative().nullable().optional(),
});

export const toolEventSchema = z.object({
  index: z.number().int().nonnegative(),
  input: z.unknown().optional(),
  kind: z.string().min(1),
  name: z.string().nullable().optional(),
  output: z.string().nullable().optional(),
});

export const conversationTurnSchema = z.object({
  assistant: z.string().nullable(),
  failureKind: z.string().nullable(),
  harness: harnessId,
  id: z.string().min(1),
  model: z.string().nullable(),
  reasoning: z.string().nullable(),
  status: z.string().min(1),
  timestamp: z.string().min(1),
  tools: z.array(toolEventSchema),
  unknown: z.record(z.string(), z.unknown()),
  usage: usageSchema,
  user: z.string(),
});

export const conversationSchema = z.object({
  canContinue: z.boolean(),
  harnesses: z.array(harnessId).max(64),
  id: sessionId,
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
  .pick({ harnesses: true, id: true, name: true, project: true, startedAt: true })
  .extend({
    turnCount: z.number().int().nonnegative(),
  });

export const bridgeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ cursor: conversationCursorSchema.optional(), kind: z.literal("list") }),
  z.object({
    kind: z.literal("get"),
    sessionId,
    turnOffset: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("continue"),
    message: z.string().trim().min(1, "Write a message first").max(32_000),
    sessionId,
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
    selectedSessionId: sessionId,
  }),
]);

export const bridgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ data: successResponseSchema, ok: z.literal(true) }),
  z.object({ error: bridgeErrorSchema, ok: z.literal(false) }),
]);

export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export type BridgeResponse = z.infer<typeof bridgeResponseSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationCursor = z.infer<typeof conversationCursorSchema>;
export type ConversationPage = z.infer<typeof conversationPageSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
