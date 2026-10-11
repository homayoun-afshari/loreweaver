import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

/** Marks the message the reflection step adds to ask the agent for a revision. */
const FEEDBACK_FLAG = "reflection_feedback";

/** The note that sends a draft back to the agent. It is a human message, so the model answers it. */
export function feedbackMessage(text: string): HumanMessage {
  return new HumanMessage({ content: text, additional_kwargs: { [FEEDBACK_FLAG]: true } });
}

export function isFeedbackMessage(message: BaseMessage): boolean {
  return message.type === "human" && message.additional_kwargs?.[FEEDBACK_FLAG] === true;
}

/** The plain text of a message, whether its content is a string or a list of blocks. */
export function textOf(message: BaseMessage): string {
  const { content } = message;
  if (typeof content === "string") return content;
  return content
    .map((block) =>
      block.type === "text" && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("");
}

/** Index of the last message that is `human` (of any kind), or -1. */
function lastHumanIndex(messages: BaseMessage[], includeFeedback: boolean): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === "human" && (includeFeedback || !isFeedbackMessage(m))) return i;
  }
  return -1;
}

/**
 * How many model calls the current draft has used: the AI messages after the last human message,
 * which is the author's question for a first draft and the feedback note for a revision.
 */
export function callsForCurrentDraft(messages: BaseMessage[]): number {
  const start = lastHumanIndex(messages, true);
  return messages.slice(start + 1).filter((m) => m.type === "ai").length;
}

/**
 * This run: the author's latest question, and everything the graph produced for it. The history
 * before the question is left out on purpose: the browser sends it and can forge it, so facts are
 * taken only from the tool results of this run.
 */
export function splitCurrentRun(messages: BaseMessage[]): { question: string; run: BaseMessage[] } {
  const start = lastHumanIndex(messages, false);
  return {
    question: start === -1 ? "" : textOf(messages[start]),
    run: messages.slice(start + 1),
  };
}
