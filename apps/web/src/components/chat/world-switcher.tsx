"use client";

import { useEffect, useId, useState } from "react";
import { KNOWN_WORLDS } from "@/lib/worlds";

/**
 * Chooses which world the chat is about. It stands in for "the signed-in author's world" until
 * there is a sign-in: the choice is kept by the server in a cookie (see lib/session.ts). The page
 * never sends a world with a question: the server reads it from the cookie.
 */
export function WorldSwitcher({
  disabled,
  onWorld,
  onChanged,
}: {
  disabled: boolean;
  /** Called with the current world once it is known, and again after every change. */
  onWorld: (worldId: string) => void;
  /** Called after the server has accepted the new world, so the chat can start afresh. */
  onChanged: () => void;
}) {
  const selectId = useId();
  const [worldId, setWorldId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session/world")
      .then((response) => response.json())
      .then((data: { worldId: string }) => {
        if (!cancelled) {
          setWorldId(data.worldId);
          onWorld(data.worldId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // The parent passes a state setter, which never changes, so this still runs once.
  }, [onWorld]);

  async function change(next: string) {
    const response = await fetch("/api/session/world", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worldId: next }),
    }).catch(() => null);
    if (response?.ok) {
      setWorldId(next);
      onWorld(next);
      onChanged();
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={selectId} className="text-muted-foreground">
        World
      </label>
      <select
        id={selectId}
        value={worldId}
        disabled={disabled || worldId === ""}
        onChange={(e) => change(e.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {worldId === "" && <option value="">…</option>}
        {KNOWN_WORLDS.map((world) => (
          <option key={world.id} value={world.id}>
            {world.label}
          </option>
        ))}
      </select>
    </div>
  );
}
