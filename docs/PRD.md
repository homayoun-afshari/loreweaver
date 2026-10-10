# Loreweaver: Product Requirements Document

**Status:** Draft v1 · **Owner:** Homayoun Afshari · **Updated:** 2026-10-10 (data, assumptions and worlds made explicit)

## Problem

Novelists who build large fictional worlds lose consistency as the world grows. A character carries an item they lost three chapters ago, a spell ignores the cost the magic system set, a city sits in the wrong place. These continuity errors and rule-breaking plot fixes are cheap to avoid while drafting and expensive to find in revision, or after publication. Lore wikis and notes help only if the author remembers to check them, and at 200 pages nobody does.

## Personas

- **Mara, indie fantasy author.** Writes alone, keeps a 200-page lore wiki, and publishes a book a year. She rereads her own wiki more than she writes. She wants fast answers she can trust, with sources.
- **The co-writing team.** Two or three authors share one world and one canon. Each knows a different slice of it. They need one source of truth for what each character has, knows and can do right now. In v1 there are no accounts, so a team shares a world simply by choosing the same one. Access per team member comes with sign-in, in a later version.

## Job to be done

> When I'm stuck in a scene, help me find options that fit my world's rules and my characters' current state.

## Data

Loreweaver works with two kinds of data about each world, and treats them differently.

|                        | **Lore** (the canon)                                                                            | **Character state**                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| What it is             | What is always true of the world: magic rules, places, history, factions, character backgrounds | What is true of each character right now: location, inventory, mana, health, condition |
| How often it changes   | Rarely, when the author revises the world                                                       | Often, as the story moves on                                                           |
| Where it lives         | Markdown files in `data/lore/<world_id>/`, the source of truth, indexed for search              | The story CMS, a separate system that owns the data                                    |
| How Loreweaver uses it | Searches it and cites the passages it uses                                                      | Reads it over the CMS's API, and never guesses it                                      |

The two meet only through the world id, which names a world both in the lore folders and in the CMS. A fact belongs to one side only: a rule never lives in the CMS, and a character's current location never lives in the lore.

## Scope (v1)

- Chat over **one world** per conversation. The world is the unit of isolation: everything a conversation can see (lore, characters, the prompt) belongs to that world.
- **Character state lookup:** location, inventory and mana for a character, read from the story CMS and never guessed.
- **Lore retrieval with citations:** answers point to the passages of the author's lore they come from.
- **Rule-consistent suggestions:** options are checked against the world's rules and the character's state before they are shown.

## Assumptions (v1)

- **The data is prepared in advance.** The lore files and the CMS records exist before anyone opens the chat. Together they describe the author's world at one moment.
- **Loreweaver never changes either kind of data.** It only reads them.
- **The lore changes only outside the product.** The files are edited and indexed again (`pnpm ingest`). Each new indexing counts as a new snapshot of the world, and only the changed passages are processed again.
- **Character state changes only in the CMS, by its owner.** This is why the product shows how fresh the state is and says when it may be stale.
- **There are no accounts.** Any visitor can open any of the known worlds. The world is chosen on the server, never by the model.

## Non-goals (v1)

- Writing whole chapters or long-form prose.
- Image generation.
- Training or fine-tuning models on user data.
- Editing the lore or the CMS from the chat (read-only in v1).
- Managing the data from the product: no lore upload, no admin screens, and no sync with the author's own tools.
- Sign-in and per-author access to worlds.
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

A cross-tenant leak is any answer, passage or character from a world other than the conversation's own.

Every figure reported in the README is measured and recorded in `docs/METRICS.md`.

## Risks and open questions

- **Stale or unavailable character state.** The CMS is a legacy system and can be slow or fail. The product must say when state may be stale instead of inventing it (see ADR-0001).
- **Hallucinated lore.** Mitigated by citations and by refusing to answer when retrieval finds nothing relevant.
- **World isolation.** A conversation must never see data from another world. Enforced in code, not in prompts (see ADR-0003).
- **No accounts yet.** Because any visitor can open any world, v1 must only hold worlds that are fine to show to everyone. Sign-in, and a list of the worlds each author may open, are a later version.
