import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { textOf } from "./messages";
import {
  buildReflectionMessages,
  caveatFor,
  checkUnavailable,
  isCheckUnavailable,
  revisionRequest,
  RULE_CHECK_UNAVAILABLE,
  RULE_UNSPECIFIED,
  toVerdict,
} from "./reflection";

const toolResult = (name: string, value: unknown) =>
  new ToolMessage({ content: JSON.stringify(value), tool_call_id: name, name });

describe("toVerdict", () => {
  it("accepts a valid verdict", () => {
    expect(toVerdict({ violations: [], valid: true })).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when it names a violation, even if the model said valid", () => {
    const violations = [{ rule_id: "3fa9c1d2", explanation: "Fire is forbidden there." }];
    expect(toVerdict({ violations, valid: true })).toEqual({ valid: false, violations });
  });

  it("gives an invalid verdict without a violation a generic one, so there is something to fix", () => {
    const verdict = toVerdict({ violations: [], valid: false });
    expect(verdict.valid).toBe(false);
    expect(verdict.violations).toHaveLength(1);
    expect(verdict.violations[0].rule_id).toBe(RULE_UNSPECIFIED);
  });

  it.each([
    null,
    undefined,
    "valid",
    { valid: "yes" },
    { violations: [{ rule_id: "" }], valid: false },
  ])("treats %j as an unavailable check", (raw) => {
    expect(isCheckUnavailable(toVerdict(raw))).toBe(true);
  });
});

describe("buildReflectionMessages", () => {
  it("puts the question, the draft and the readable tool results in the prompt", () => {
    const [system, human] = buildReflectionMessages({
      question: "How can Aria escape?",
      draft: "Use the flint.",
      run: [
        toolResult("fetch_character_state", {
          ok: true,
          character: {
            name: "Aria Voss",
            location: { code: 17, name: "Ice Citadel" },
            inventory: ["flint", "broken sword"],
            mana: 20,
            hp: 85,
            condition: "healthy",
          },
        }),
        toolResult("search_lore", {
          ok: true,
          hits: [
            {
              citationId: "3fa9c1d2",
              headingPath: "Magic > Fire",
              content: "Fire needs flint.",
            },
          ],
        }),
        new AIMessage("Use the flint."),
      ],
    });
    expect(system.type).toBe("system");
    const text = textOf(human);
    expect(text).toContain("How can Aria escape?");
    expect(text).toContain("Use the flint.");
    expect(text).toContain("Aria Voss is at Ice Citadel");
    expect(text).toContain("carries: flint, broken sword");
    expect(text).toContain("passage 3fa9c1d2 (Magic > Fire): Fire needs flint.");
  });

  it("tells the checker to ignore omissions and to keep explanations short", () => {
    const [system] = buildReflectionMessages({ question: "q", draft: "d", run: [] });
    const text = textOf(system);
    expect(text).toMatch(/do not report omissions/i);
    expect(text).toMatch(/at most 25 words/i);
  });

  it("says so when there is no evidence, and reports failed tools as failures", () => {
    expect(textOf(buildReflectionMessages({ question: "q", draft: "d", run: [] })[1])).toContain(
      "(none)",
    );
    const failed = buildReflectionMessages({
      question: "q",
      draft: "d",
      run: [toolResult("search_lore", { ok: false, error: { message: "down" } })],
    });
    expect(textOf(failed[1])).toContain("[search_lore] failed: down");
  });
});

describe("what the author and the agent are told", () => {
  it("lists every violation in the revision request", () => {
    const text = revisionRequest([
      { rule_id: "inventory", explanation: "She has no rope." },
      { rule_id: "3fa9c1d2", explanation: "Fire is forbidden there." },
    ]);
    expect(text).toContain("- [inventory] She has no rope.");
    expect(text).toContain("- [3fa9c1d2] Fire is forbidden there.");
  });

  it("lists the unresolved violations in the caveat", () => {
    const text = caveatFor({
      valid: false,
      violations: [{ rule_id: "inventory", explanation: "She has no rope." }],
    });
    expect(text).toContain("may still conflict with the world's rules");
    expect(text).toContain("- She has no rope. (inventory)");
  });

  it("uses a different caveat when the check could not run", () => {
    const verdict = checkUnavailable();
    expect(verdict.violations[0].rule_id).toBe(RULE_CHECK_UNAVAILABLE);
    expect(caveatFor(verdict)).toContain("could not be checked");
  });
});
