# Mini model benchmark

The full record of the Day 2 benchmark: why it was run, exactly how, the prompts, the scoring and the answers.
The numeric results, the caveats and the reproduce command are in [METRICS.md](METRICS.md). The decision they support is ADR-0002.

## 1. Question and decision

**Question:** which Claude model should the agent node use: the small, fast **Claude Haiku 4.5** or the larger **Claude Sonnet 5.5**?

**Decision it feeds:** the model for **Preview and Production** (ADR-0002). Development uses Haiku regardless, as a cost rule.

## 2. Scope: what this test does and does not cover

| Included                                                                           | Not included (yet)                                                                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The real chat route `POST /api/chat`: request validation, system prompt, streaming | **The legacy CMS.** It was **not called**: there are no tools yet (`fetch_character_state` is a later Day 2 step) |
| One user message per request (no history)                                          | Multi-turn conversations                                                                                          |
| Plain text answers                                                                 | Tool calls, the Character Status Card, the agent loop (Day 4)                                                     |
| Questions that need **no** world data                                              | Lore retrieval (RAG, Day 3)                                                                                       |

Because no real world data is connected, the prompts either need no data (rules, brainstorming) or test whether the model **admits** it has none (P3). The prompts therefore cannot show how a model handles tool results.

A full agent answer will be slower than these numbers: it adds the CMS call (measured in [METRICS.md](METRICS.md#day-1-legacy-cms-and-legacy-client)), the model's tool-choosing step and more tokens. So these numbers describe the **model alone**, not the finished product.

## 3. Setup

| Item          | Value                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it ran  | Local dev server (`pnpm dev`) on my laptop. The script calls `http://localhost:3000/api/chat`, so the route is included. The model call goes to the real Anthropic API                  |
| Models        | `claude-haiku-4-5` ($1 / $5 per million input / output tokens) and `claude-sonnet-5-5` ($2 / $10). Prices as published by Anthropic at the time                                         |
| Credentials   | Dev API key, scoped to a workspace                                                                                                                                                      |
| System prompt | The original three-line prompt (at commit `414cddb`, in `apps/web/src/lib/ai/system-prompt.ts`, since replaced by `src/lib/prompts/agent.v1.md`), identical for both models (see below) |
| Sampling      | Provider defaults. Temperature, top-p and max tokens were **not** set                                                                                                                   |
| Runs          | 1 run per prompt and model: 10 calls in total                                                                                                                                           |
| Order         | All Haiku prompts, then all Sonnet prompts, one at a time (no parallel calls)                                                                                                           |
| Script        | `apps/web/scripts/benchmark.ts`, run with `pnpm benchmark`                                                                                                                              |

**System prompt used (verbatim):**

> You are Loreweaver, a worldbuilding copilot for novelists.
> Help the author with questions about their fictional world: characters, places, magic, plot options.
> Be concise and concrete. If you do not know a fact about the author's world, say so instead of inventing it.

If this prompt changes, the results are no longer comparable: re-run both models.

The timing, token and cost figures, with their definitions, are in [METRICS.md](METRICS.md#day-2-mini-model-benchmark).

## 4. Prompts (verbatim)

The same five prompts, sent once to each model.

| ID  | What it tests                                                    | Prompt                                                                                                                           |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Creative brainstorming within given constraints                  | In my fantasy world magic costs mana and the Ice Citadel is frozen all year. Give me three plot complications for a heist there. |
| P2  | A rule check with arithmetic (wants low randomness)              | A mage has 5 mana. Fireball costs 8 mana and Spark costs 2. Can she cast Fireball and then Spark? Answer in two sentences.       |
| P3  | Honesty: does it admit it lacks world data, instead of inventing | What is the name of the blacksmith in my world?                                                                                  |
| P4  | Following a format exactly, plus originality                     | List four distinct factions for a world where the moon is a prison. One line each.                                               |
| P5  | Short prose with a hard length limit                             | Describe a market at dusk in a city built inside a dead giant, in two sentences.                                                 |

## 5. Quality scoring

**Rubric (1 to 5):** correct, follows the instructions exactly (length, format), useful to a novelist, and says "I don't know" instead of inventing the author's canon.

These scores are a **first pass** (one reader, with an AI assistant's help, not blind). They can be changed after reading the answers in section 6.

| Prompt        | Haiku 4.5 | Sonnet 5.5 | Why                                                                                                                                          |
| ------------- | :-------: | :--------: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 plot ideas |     4     |     4      | Both give three usable complications, and in both two of the three overlap (mana cost of cold). Sonnet is more developed                     |
| P2 rule check |     4     |     5      | Both reach the right answer. Haiku's explanation is muddled ("leaving her -3 mana"). Sonnet is clear and adds that Spark could be cast twice |
| P3 honesty    |     5     |     5      | Both refuse to invent a name and ask for context                                                                                             |
| P4 factions   |     3     |     5      | Haiku's factions are generic (Jailers, Liberation Front). Sonnet's are more original and it says it is inventing them                        |
| P5 prose      |     3     |     4      | Haiku writes one very long sentence plus a title, not two sentences. Sonnet writes two sentences and then adds an unrequested question       |
| **Average**   |  **3.8**  |  **4.6**   |                                                                                                                                              |

## 6. Responses (verbatim)

Answers are quoted as received. The models used Markdown (`#` titles, `**bold**`); the chat UI does not render it yet.

#### claude-haiku-4-5, P1 plot ideas

> # Three Heist Complications for the Ice Citadel
>
> **1. Mana Depletion in Cold**
> The extreme cold drains mana faster than normal—perhaps spells cost 50% more, or mana regenerates slower. Your thieves must choose: use magic to stay warm and lose spellcasting power for the heist, or endure the cold and arrive weakened. This forces hard tradeoffs during the actual theft.
>
> **2. Frozen Magical Wards**
> The citadel's protective spells are enhanced by the permanent ice—they're harder to dispel, trigger in cascading chains when broken, or require unusual methods to disable (maybe they need to be _melted_ rather than countered). A straightforward magical bypass won't work.
>
> **3. The Citadel Itself Hunts Intruders**
> The building is semi-alive or magically animate—it redirects corridors, seals passages, or creates ice obstacles that actively pursue thieves. Worse: it _consumes_ mana from anyone casting inside it, feeding its own defenses. The longer they stay and the more magic they use, the more the citadel wakes up against them.
>
> ---
>
> **What's your heist's main goal?** (Steal an object? Free a prisoner? Sabotage something?) That might help me suggest complications that tie directly to your plot.

#### claude-haiku-4-5, P2 rule check

> No, she cannot. Casting Fireball would cost 8 mana, leaving her with -3 mana, which is impossible—she doesn't have enough to cast it in the first place.

#### claude-haiku-4-5, P3 honesty

> I don't have any information about your world yet. We haven't discussed your setting, characters, or story details.
>
> Could you tell me about your blacksmith? For example:
>
> - What's the name of your world or story?
> - Where does this blacksmith work?
> - What role do they play in your plot?
> - Have you already named them, or are you looking for name ideas?
>
> Once you share some details, I can help you develop this character and explore how they fit into your world.

#### claude-haiku-4-5, P4 structured list

> # Four Factions for a Moon-Prison World
>
> 1. **The Jailers** — Government enforcers who maintain the lunar prison and believe strict confinement prevents catastrophe on the homeworld.
>
> 2. **The Liberation Front** — Revolutionaries convinced the prisoners are wrongly imprisoned and fight to free them, consequences be damned.
>
> 3. **The Profiteers** — Corporate merchants who exploit the prison system through supply contracts, prisoner labor, and black-market trade.
>
> 4. **The Architects** — A secretive cult that believes the moon-prison was built for a sacred purpose and opposes any interference with its original design.

#### claude-haiku-4-5, P5 prose

> # Market at Dusk in the Giant's Corpse
>
> Lanterns flicker to life among vendor stalls nestled in the ribcage bazaar, casting dancing shadows across bone-white archways while merchants call out their wares—spiced meats, woven cloths, salvaged artifacts from the giant's hollow depths. Above, the last light filters through cracks in the skull-dome ceiling, painting the cavernous market in shades of amber and rust as the day-shift crowd thins and night-dwellers emerge from the shadowed chambers below.

#### claude-sonnet-5-5, P1 plot ideas

> Here are three complications built on the two facts you gave me: magic costs mana, and the Citadel is frozen year-round.
>
> 1. **The cold taxes the crew's mana.** Suppose every spell cast in the Citadel costs more, or mana regenerates more slowly in the freeze. The crew budgeted for normal conditions, so by the time they reach the vault their mage is running on fumes. Now every spell is a gamble: do they spend mana on the lock, or save it for the escape?
>
> 2. **The heat problem.** Keeping warm without magic is hard, but warming spells burn mana. The crew has to choose between staying functional (fingers that can pick locks, bodies that don't slow down) and saving mana for the job. A rival or traitor could exploit this by quietly draining a teammate's reserves or sabotaging their cold-weather gear.
>
> 3. **The thaw trap.** Any big fire or heat-based spell risks melting the structure, whether that's a door, a floor, or a load-bearing wall. The crew's best tool for breaching the vault could collapse the passage behind them, forcing them to find another way out. Even a small mistake leaves telltale meltwater or steam that guards can track.
>
> If you tell me how mana works in your world (personal reserves, ambient sources, items that store it), I can tailor these. Does the Citadel have its own defenses or inhabitants? I don't know those details yet, so I haven't assumed any.

#### claude-sonnet-5-5, P2 rule check

> No, she can't, because Fireball costs 8 mana and she only has 5, so she can't cast it at all, whether or not Spark follows. She could cast Spark (2 mana) up to twice with her 5 mana, unless your world has rules like borrowing mana from other sources or paying with health that I don't know about.

#### claude-sonnet-5-5, P3 honesty

> I don't have any details about your world yet, so I don't know your blacksmith's name. Nothing has been shared with me in this conversation, and I'd rather not invent one and have it mistaken for your canon.
>
> If you tell me about the character, I can work with that. And if you haven't named them yet, I can suggest names if you give me a bit of context:
>
> - **Culture or region:** Is it Norse-inspired, desert-dwelling, invented language?
> - **Tone:** Gritty, folksy, mythic?
> - **Role:** Is the smith a minor background figure or someone central to the plot?
>
> Or if the name is in your notes, paste the relevant section and I can help from there.

#### claude-sonnet-5-5, P4 structured list

> 1. **The Wardens of the Tide:** An inherited priesthood that maintains the seals on the moon, believing the tides are the prisoners' pulse and must be kept in rhythm.
> 2. **The Hollow Choir:** A cult that hears the prisoners singing and wants to free them, convinced the inmates were jailed for truths the world couldn't face.
> 3. **The Lamplighters' Compact:** Merchants and engineers who profit from "moonfall," the strange materials that drift down from the prison, and who quietly sabotage anything that might disrupt supply.
> 4. **The Unlit:** Descendants of people who were exiled up to the moon and returned, now outcasts who know the prison's inner workings and trust no one.
>
> I'm inventing these from scratch, so tell me about your world's tone, tech level, and why the moon became a prison, and I can tailor them or build in rivalries between them.

#### claude-sonnet-5-5, P5 prose

> As dusk bleeds through the translucent membrane of the giant's ribcage, vendors hang bioluminescent lanterns from the curved bone arches, and the stalls along the old sternum glow amber against the deepening violet. The air smells of smoked marrow and tallow candles, while the low, slow rumble of wind through the vast hollow of the lungs hums beneath the haggling like a lullaby the dead god never finished.
>
> If you tell me which giant this is (how it died, how long ago, and what the citizens believe about it), I can tune the details to fit.

## 7. Results, caveats and how to re-run

The numbers, the caveats and the command to re-run are in [METRICS.md](METRICS.md#day-2-mini-model-benchmark). They are kept there only, so they are not written twice.
