import type {
  Conversation as ValidatedConversation,
  ConversationSummary as ValidatedConversationSummary,
  ConversationTurn as ValidatedConversationTurn,
} from "@oneharness-ui/ipc-contract";
import type { Conversation, ConversationSummary, ConversationTurn } from "./presentational-types";

type Extends<Source, Target> = Source extends Target ? true : false;
type Assert<T extends true> = T;

export type PresentationalContractDriftGate = [
  Assert<Extends<ValidatedConversation, Conversation>>,
  Assert<Extends<Conversation, ValidatedConversation>>,
  Assert<Extends<ValidatedConversationSummary, ConversationSummary>>,
  Assert<Extends<ConversationSummary, ValidatedConversationSummary>>,
  Assert<Extends<ValidatedConversationTurn, ConversationTurn>>,
  Assert<Extends<ConversationTurn, ValidatedConversationTurn>>,
];
