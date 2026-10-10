"use client";

import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FeedbackRequest } from "@/lib/feedback/feedback-request";

type Rating = "up" | "down";

/** How long the copy button shows its "copied" tick. */
const COPIED_MS = 1500;

type Props = {
  chatId: string;
  messageId: string;
  /** The plain text of the message, for the copy button. */
  text: string;
  modelId?: string;
  promptVersion?: string;
};

/** Thumbs up, thumbs down and copy for one finished assistant message. Each click is stored. */
export function MessageActions({ chatId, messageId, text, modelId, promptVersion }: Props) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function record(kind: FeedbackRequest["kind"]): Promise<boolean> {
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, messageId, kind, modelId, promptVersion }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function rate(next: Rating) {
    if (rating === next) return; // already recorded, nothing new to say
    const previous = rating;
    setRating(next); // optimistic: the button reacts at once
    setFailed(false);
    if (!(await record(next))) {
      setRating(previous);
      setFailed(true);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard blocked: nothing was copied, so nothing to record
    }
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
    void record("copy");
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Good answer"
        aria-pressed={rating === "up"}
        className={rating === "up" ? "text-foreground" : "text-muted-foreground"}
        onClick={() => rate("up")}
      >
        <ThumbsUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Bad answer"
        aria-pressed={rating === "down"}
        className={rating === "down" ? "text-foreground" : "text-muted-foreground"}
        onClick={() => rate("down")}
      >
        <ThumbsDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : "Copy answer"}
        className="text-muted-foreground"
        onClick={copy}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          Could not save feedback.
        </span>
      )}
    </div>
  );
}
