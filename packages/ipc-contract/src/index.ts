import { z } from "zod";

const sessionId = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[\p{L}\p{N}._-]+$/u, "Invalid session identifier");

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
  harness: z.string().min(1),
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
  harnesses: z.array(z.string()),
  id: sessionId,
  name: z.string().min(1),
  project: z.string(),
  startedAt: z.string(),
  state: z.string().min(1),
  turns: z.array(conversationTurnSchema),
});

export const conversationSummarySchema = conversationSchema.omit({ turns: true }).extend({
  preview: z.string(),
  turnCount: z.number().int().nonnegative(),
});

export const bridgeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list") }),
  z.object({ kind: z.literal("get"), sessionId }),
  z.object({
    kind: z.literal("continue"),
    message: z.string().trim().min(1, "Write a message first").max(32_000),
    sessionId,
  }),
]);

export const bridgeErrorSchema = z.object({
  code: z.string().min(1),
  detail: z.string().optional(),
  message: z.string().min(1),
});

const successResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), conversations: z.array(conversationSummarySchema) }),
  z.object({ kind: z.literal("get"), conversation: conversationSchema }),
  z.object({
    kind: z.literal("continue"),
    conversation: conversationSchema,
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
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
