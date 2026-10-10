"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIDataTypes, type UIMessage } from "ai";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatTools } from "@/lib/ai/tools";
import {
  CharacterStatusCard,
  CharacterStatusCardError,
  CharacterStatusCardSkeleton,
} from "./character-status-card";

/** Chat messages whose tool parts are typed with our tools (so `part.output` has a real type). */
type ChatMessage = UIMessage<unknown, UIDataTypes, ChatTools>;

/** How close to the bottom (in px) the user must be for new text to keep scrolling the view. */
const STICK_TO_BOTTOM_PX = 80;

export function ChatPanel() {
  // Without an id, useChat makes a random one while the page is prerendered, which Next.js
  // refuses (the value would be frozen into the static HTML). useId() is stable and safe.
  const chatId = useId();
  const { messages, sendMessage, status, error, stop, regenerate } = useChat<ChatMessage>({
    id: chatId,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  // True while the user is reading at the bottom. If they scroll up, we stop pulling them down.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";
  const canRegenerate = !busy && messages.at(-1)?.role === "assistant";

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    stickToBottom.current = true;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col gap-3 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Loreweaver</h1>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
        }}
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border p-4"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask about your world, for example: “What does Kael have on them?”
          </p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            {/* Each part is its own block: text goes in a bubble, a tool part becomes a card. */}
            <div className="flex max-w-[85%] flex-col items-start gap-2">
              {message.parts.map((part, index) => {
                switch (part.type) {
                  case "text":
                    return (
                      <div
                        key={index}
                        className={
                          message.role === "user"
                            ? "rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                            : "rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
                        }
                      >
                        {part.text}
                      </div>
                    );
                  // Generative UI: a tool part becomes a component, chosen by the part's state.
                  case "tool-fetch_character_state":
                    switch (part.state) {
                      case "input-streaming":
                      case "input-available":
                        return <CharacterStatusCardSkeleton key={part.toolCallId} />;
                      case "output-available":
                        return part.output.ok ? (
                          <CharacterStatusCard
                            key={part.toolCallId}
                            character={part.output.character}
                          />
                        ) : (
                          <CharacterStatusCardError
                            key={part.toolCallId}
                            error={part.output.error}
                          />
                        );
                      case "output-error":
                        return <CharacterStatusCardError key={part.toolCallId} />;
                      default:
                        return null;
                    }
                  default:
                    return null;
                }
              })}
            </div>
          </div>
        ))}

        {status === "submitted" && <p className="text-sm text-muted-foreground">Thinking…</p>}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>Something went wrong. Please try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => regenerate()}>
            Retry
          </Button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about your world…"
          aria-label="Your message"
          rows={2}
        />
        <div className="flex justify-end gap-2">
          {canRegenerate && (
            <Button type="button" variant="outline" onClick={() => regenerate()}>
              Regenerate
            </Button>
          )}
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => stop()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
