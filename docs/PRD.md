# Loreweaver: Product Requirements Document

**Status:** Draft v1 · **Owner:** Homayoun Afshari

## Problem

Novelists who build large fictional worlds lose consistency as the world grows. A character carries an item they lost three chapters ago, a spell ignores the cost the magic system set, a city sits in the wrong place. These continuity errors and rule-breaking plot fixes are cheap to avoid while drafting and expensive to find in revision, or after publication. Lore wikis and notes help only if the author remembers to check them, and at 200 pages nobody does.

## Personas

- **Mara, indie fantasy author.** Writes alone, keeps a 200-page lore wiki, and publishes a book a year. She rereads her own wiki more than she writes. She wants fast answers she can trust, with sources.
- **The co-writing team.** Two or three authors share one world and one canon. Each knows a different slice of it. They need one source of truth for what each character has, knows and can do right now.

## Job to be done

> When I'm stuck in a scene, help me find options that fit my world's rules and my characters' current state.

## Scope (v1)

- Chat over **one world** per conversation.
- **Character state lookup:** location, inventory and mana for a character, read from the story CMS and never guessed.
- **Lore retrieval with citations:** answers point to the passages of the author's lore they come from.
- **Rule-consistent suggestions:** options are checked against the world's rules and the character's state before they are shown.

## Non-goals (v1)

- Writing whole chapters or long-form prose.
- Image generation.
- Training or fine-tuning models on user data.
- Editing the lore or the CMS from the chat (read-only in v1).
- Storing or searching the author's manuscript. The prose of the book stays in the author's own writing tool. The assistant knows the world's lore (searchable, with citations) and each character's current state (from the CMS), and sees a scene only if the author pastes it into the chat, in which case it is used for that answer and not stored.

## Success metrics

**North Star:** weekly accepted suggestions per active author.

**Guardrails:**

| Metric                                    | Target  |
| ----------------------------------------- | ------- |
| p95 latency (question to complete answer) | < 8 s   |
| Cost per query                            | < $0.05 |
| Rule-violation rate in suggestions        | < 5 %   |
| Cross-tenant leaks                        | 0       |

Every figure reported in the README is measured and recorded in `docs/METRICS.md`.

## Risks and open questions

- **Stale or unavailable character state.** The CMS is a legacy system and can be slow or fail. The product must say when state may be stale instead of inventing it (see ADR-0001).
- **Hallucinated lore.** Mitigated by citations and by refusing to answer when retrieval finds nothing relevant.
- **Tenant isolation.** One author must never see another author's world. Enforced in code, not in prompts.
