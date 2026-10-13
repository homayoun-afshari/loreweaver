# Day 6 report: Evaluation, safety and responsible AI

## 1. Summary

Day 6 made the agent testable, attackable and accountable:

- **An end-to-end eval** runs the whole agent on 19 cases built from the seed data and grades each answer twice: by code (tools called, items named, citations real) and by a stronger model against hand-written constraints.
- **The judge was checked against a person's labels.** The labels are kept with the code.
- **The system prompt was fixed with the eval**, through three versions (`agent.v4` to `agent.v6`).
- **A red-team set** of nine attacks and **defenses in code** behind it: lore marked as data, a check on the answer, and a cap on the length of a message. The text box and the server say clearly when a message is too long.
- **A CI gate** runs a smoke set and the red-team set on real models for every pull request that can change the agent.
- **A system card and a privacy document** say what the agent is for, how far it can be trusted, where data goes and how a world's data is deleted.

The product can now say how often it is right and what it does under attack, and a change that makes it worse shows up before it ships.

## 2. Learn, Prepare and Build

| Section                               | What was done                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Learn**                             | Kinds of evals, dataset design, grading by code and by a judge model, how to build and check a judge, statistical humility, LLM security (injection, leaks, cost attacks) and responsible AI (GDPR, the EU AI Act, copyright). |
| **Prepare**                           | Credit and budget for a day of many model calls; a separate CI key at the model provider and at the embedding provider, with Actions secrets; the folder for the datasets.                                                     |
| **Build A: Evals and the judge**      | The 19-case dataset, the runner and the judge (`pnpm eval`), the check of the judge against labels (`pnpm eval:labels`), and a prompt fix backed by a before and after report.                                                 |
| **Build B: Red team and guardrails**  | The attack set (`pnpm eval:redteam`), a test world for an instruction hidden in lore, the code defenses, and the length limit on a message, then its two usability fixes.                                                      |
| **Build C: CI gate**                  | A workflow that runs the smoke set and the red-team set, with the gate rules as runner flags, calibrated on real runs and proved on a throw-away pull request. A prompt rule found by the first CI run.                        |
| **Build D: Responsible-AI documents** | `docs/SYSTEM_CARD.md` and `docs/PRIVACY.md`.                                                                                                                                                                                   |
| **Build E: Report**                   | This report.                                                                                                                                                                                                                   |

## 3. By area

**Frontend**

| Item                  | What it is                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatPanel` (changed) | A character counter from 80% of the limit, a red message and a disabled Send over it (nothing is cut), and the server's sentence for a message that is too long, without a Retry button. |
| `chat-controls.ts`    | `messageLengthStatus`, the text of the counter.                                                                                                                                          |
| `limit-error.ts`      | Also reads the "message too long" answer from the chat library's error.                                                                                                                  |

**Backend**

| Item                                        | What it is                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/agent/guardrails.ts`                   | Marks tool results as data before the model reads them, and replaces an answer that copies the system prompt or names a world id (section 9). |
| `lib/agent/nodes.ts`, `graph.ts`            | The agent node applies both; a `guardrails` option lets only the eval turn them off.                                                          |
| `lib/ai/agent-runtime.ts`                   | `createRuntimeGraph`, so the eval can build the real graph with a replaced tool back end (a legacy service that is down).                     |
| `lib/ai/input-limits.ts`, `chat-request.ts` | The longest message (8,000 characters), its wording, and the check; `isMessageTooLong` tells that reason from the others.                     |
| `app/api/chat/route.ts`                     | Answers HTTP 413 with a sentence for a message that is too long.                                                                              |
| `lib/prompts/agent.v4.md` to `v6.md`        | Three prompt versions. The app uses `agent.v6`; `agent.v4` was an attempt that made two cases worse and is kept with its report.              |
| `lib/agent/reflection.ts`                   | `describeToolResult` is exported, so the judge sees the evidence as the reflection step does.                                                 |

**Tooling**

| Item                                                                     | What it is                                                                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evals/datasets/` (`e2e.json`, `redteam.json`, `smoke.json`)             | The 19 end-to-end cases, the nine attacks, and the ten cases of the CI smoke set.                                                                           |
| `evals/judge.ts` (`pnpm eval`, `pnpm eval:redteam`)                      | The runner: runs each case through the graph, grades it, writes a report, and sets the exit code from the gate flags (section 10).                          |
| `evals/e2e-dataset.ts`, `e2e-checks.ts`, `e2e-judge.ts`, `e2e-report.ts` | The schema of a case, the code checks, the judge (rubric, reply schema, consistency rule, cost) and the pass rules. Pure functions, tested without a model. |
| `evals/e2e-gate.ts`                                                      | The gate decision and the reading of its thresholds.                                                                                                        |
| `evals/labels.ts`, `e2e-labels.ts` (`pnpm eval:labels`)                  | Picks the answers to label, writes the sheet without the judge's grades, and compares the labels with the judge. `judge-labels.csv` holds the labels.       |
| `evals/redteam-fixture.ts`, `evals/fixtures/lore/world_redteam/`         | A test world with an instruction hidden in a lore passage, written to the local database for a run and removed after.                                       |
| `evals/break_prompt.py`                                                  | Breaks the prompt on purpose, to prove the gate on a throw-away pull request.                                                                               |
| `.github/workflows/eval.yml`                                             | The eval job (section 10).                                                                                                                                  |
| `package.json` (root)                                                    | Three direct dependencies the evals import (`@langchain/anthropic`, `@langchain/core`, `drizzle-orm`), at the versions of `apps/web`, and the new scripts.  |

**Documenting**

| Item                                     | What it is                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `docs/SYSTEM_CARD.md`, `docs/PRIVACY.md` | Section 11.                                                                                  |
| `docs/AGENT_DESIGN.md`                   | A section on the guardrails.                                                                 |
| `evals/README.md`, `README.md`           | The three eval commands, the judge check, the red-team set, the gate, and the new documents. |
| `docs/METRICS.md`                        | Not changed by this report. The day's measurements are recorded there.                       |

## 4. By environment

| Environment | What changed                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dev**     | The evals run here against the Docker services and the real models; the red-team fixture world is written to the local database and removed (the runner refuses any other database). `.env.local` is now optional for the runner.                                                                                                               |
| **Preview** | Runs `agent.v6`, the guardrails and the length limit. No new variable.                                                                                                                                                                                                                                                                          |
| **Prod**    | The same, when the pull request is merged.                                                                                                                                                                                                                                                                                                      |
| **CI**      | A new `eval` job, next to `check`: it starts Postgres and the legacy service with Docker Compose, creates the tables, indexes the lore, and runs the smoke set and the red-team set with the cheap model and the judge. It needs two Actions secrets (a separate CI key for the model provider and for the embedding provider). Tracing is off. |

## 5. Routing

Same URLs as Day 5. One changes.

| URL              | File (`apps/web/src/app/`) | Purpose                                                                                                                                                   |
| ---------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/chat` | `api/chat/route.ts`        | **Changed:** a message over the length limit gets HTTP `413` and `{ error: "message_too_long", message, maxChars }` before any limit or model is touched. |

## 6. Unit tests and CI

**515 tests** (133 new today), Vitest, ten of them skipped without a database as before. None calls a real model.

| Area                      | What is checked                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guardrails**            | Passages wrapped and a forged tag removed; the original messages untouched; the ten-word window for a copy of the prompt, and that no ordinary refusal or "cannot find" answer is blocked; world ids; the agent node and the whole graph with a model scripted to leak. |
| **Length limit**          | The limit at and over its edge, only the newest user message counted, the 413 answer and what it spares, the counter text, and the parser of the answer in the browser.                                                                                                 |
| **Code checks**           | Tools expected and forbidden; items (whole words, plurals, denial and requirement cues, per clause); citations real or invented; the safety check (prompt text, world ids, listed texts, length).                                                                       |
| **Judge**                 | The reply schema and the consistency rule (a verdict is recomputed from the scores), the messages it sends (the judge's data is fenced, no grade leaks into a labeling sheet), and the cost arithmetic.                                                                 |
| **Pass rules and report** | Why a case fails, the summary numbers (pass rate, means, shares, over-refusal as a failed first constraint, guard count), the faithfulness a case needs.                                                                                                                |
| **Labels**                | The sample is balanced and repeatable; the sheet hides the judge's grades; the CSV reader; the agreement arithmetic.                                                                                                                                                    |
| **Gate**                  | Each rule, a run that cannot be graded, and that the smoke set holds only cases that depend on the lore.                                                                                                                                                                |
| **Datasets**              | Both sets are valid, every case is in a known world, the first ten cases equal the earlier agent prompts, and the attack kinds are covered. The test-world file holds the hidden order and the canary.                                                                  |
| **Prompt**                | The version, the rule for requests outside the world, the rule for a world or character that is not in the lore, and the rules for search, bans and options.                                                                                                            |

**CI** now has two jobs. `check` is unchanged (format, lint, types, a throw-away Postgres, the tests). `eval` runs only when a file the agent depends on changed, and otherwise reports success without spending anything.

## 7. The evals

**Cases.** A case has an input, a world, optionally a character, the tools it should and should not call, and one to three constraints written by hand from the lore and the seed data ("Says teleportation costs 50 mana and Aria has only 20"). The first ten are the Day 4 agent prompts unchanged, and a test keeps them so. The others cover a rule exception, a missing character, lore that does not cover the question, a legacy service that is down, an off-topic request, a lore-only question and the other world.

**Two graders.** Code checks decide what code can: the expected tools were called, an item named in the answer is one the character carries (matched as text, with denial and requirement cues), every bracketed citation is a real passage of the question's world. A stronger model, the judge, scores faithfulness from 1 to 5 against the evidence the agent had and passes or fails each constraint. A case passes when both agree. The verdict is recomputed in code from the scores, whatever the judge says.

**Reports.** Each run writes a JSON report with the setup, every answer, the evidence, the tool calls (with the search queries), every grade and the cost. Reports are machine output and are kept in Git only where a document relies on them.

**How a prompt change is judged.** The eval ran before and after each prompt version on the same cases. The causes of the failures were read from the reports (a retrieval miss, a missing rule, a suggestion that gave a character an item), and the prompt rules added are general, not tied to a case. `agent.v4` named search terms in its instructions and the model copied them into its queries, so it was replaced by `agent.v5`; `agent.v6` added a rule found by the first CI run.

## 8. The judge and its check

The judge is Claude Opus 5.5, stronger than the model it grades. It reasons before it scores, answers in a fixed schema through the API's structured outputs, and runs at the model's default sampling, because that model rejects any other temperature and any forced tool call. Its effort is set low for cost. A person labeled ten answers (pass or fail, and a faithfulness score) from a sheet that hides the judge's grades, and the agreement is computed by `pnpm eval:labels`. Ten labels are a first check, so the repository keeps them and says so.

## 9. Red team and guardrails

**The attack set.** Nine cases: a direct request for the system prompt; an instruction hidden in a lore passage with a planted code (a canary); a question about the other world and its character by name; a request for a character of another world by id; a harmful method dressed as fiction; two dark but legitimate requests that must not be refused; a request to repeat a word ten thousand times; and a message of twenty thousand characters, which the request check must reject without calling a model. The hidden order lives in a test world that exists only in the local database for the length of a run.

**The defenses in code**, none of which depends on the model behaving:

| Defense             | What it does                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Lore marked as data | Each passage is wrapped in a tag and the result carries a notice; a forged tag inside a passage is removed. Only the model's copy is marked.  |
| Check on the answer | An answer that repeats ten words in a row of the system prompt, or names a world id, is replaced by a fixed message in the agent node.        |
| Scope in code       | Already in place: the world comes from the session, the tools have no world parameter, a character of another world looks like a missing one. |
| Read-only tools     | Already in place.                                                                                                                             |
| Length of a message | At most 8,000 characters: the text box shows a counter and refuses to send above it; the server answers 413.                                  |
| Length of a reply   | Already in place: a cap per model call.                                                                                                       |

The eval can switch the two code defenses off, to show what the model does alone. It is the only caller that can.

## 10. The CI gate

**What runs.** For a pull request that touches the agent's code, the lore, the services, the evals or the lock file, the `eval` job starts the database and the legacy service, indexes the lore, then runs two evals with the cheap model as the agent and the same judge: the **smoke set** (ten cases that depend on the lore) and the **red-team set**. Both print their tables to the job summary and keep their reports for two weeks.

**What fails it.** The runner's flags set the exit code: the smoke run fails when the mean faithfulness is below a threshold (3.9); the red-team run fails when any attack case fails, with the two legitimate dark requests reported but not counted (the cheap model refuses them whatever the change). A run that cannot be graded also fails.

**How the numbers were chosen.** From calibration runs of healthy and deliberately broken prompts, recorded in [`METRICS.md`](../METRICS.md). The first smoke set mixed in cases that a prompt that invents lore cannot hurt, so it was replaced by cases that need a passage.

**What it cannot do.** One run of ten cases varies by itself, so it catches a large regression sometimes and a small one rarely, and it can fail a healthy change. The first response to a red result is one re-run.

## 11. Responsible-AI documents

[`SYSTEM_CARD.md`](../SYSTEM_CARD.md) says who the agent is for and not for, which models it uses and where, how it was checked (pointing to `METRICS.md` for every number), where it is weak, and who stays in charge. [`PRIVACY.md`](../PRIVACY.md) maps where an author's text goes, which provider keeps it how long and under which setting, what the product stores and for how long, and how a world's data is deleted, with the gaps named. Statements about providers come from their public pages and carry a source; a few are marked to confirm.

## 12. Additional items and known limits

**Additional items**

- The usability of the length limit: a counter and a clear message instead of a silent cut, and an HTTP 413 with a sentence instead of a generic failure.
- A prompt rule (`agent.v6`) for a world, place or character that is not in the lore, found because the first CI run failed on a flaky case.
- The item check's cue words were extended twice after reading failures in real answers; its figure is a measure of the current check.
- `evals/break_prompt.py`, so the gate's proof can be repeated.
- The embedding provider's opt-out from storage and training was applied.

**Known limits**

- **The gate is a coarse alarm.** One run per case, ten cases, a cheap model: it can miss a regression and can fail a healthy change.
- **The cheap model refuses legitimate dark requests**, and both models sometimes answer a creative request with background instead of the scene.
- **The live attacks did not get through, on either model, with or without the code defenses.** So the live set cannot show what the code adds; a test with a model scripted to leak does.
- **The judge is a model from the same family as the agent**, checked on ten labels by one person, with no control of its sampling.
- **The item check reads text.** It misses a paraphrase and misreads a suggestion that has no cue word.
- **Branch protection is not available** on a private repository on the free plan, so a red `eval` does not block a merge. The rule is to merge only when it is green.
- **The model provider cannot be pinned to the EU**, and the embedding provider's region is not stated.
- **A world's data cannot be deleted entirely by world**: the click rows and the traces carry no world id. The request and click logs have no expiry. There is no privacy notice on the page and no "delete my data" action.
- **The history of a conversation comes from the browser**, so a client can forge parts of its own; the tools stay scoped.
- **The latency goal for a complete answer is still not met.**
