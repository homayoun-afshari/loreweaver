# System card: Loreweaver

A system card says what a model-based product is for, what it is not for, what it is made of, how well it was checked, where it is weak, and who stays in charge. This one describes the Loreweaver agent as it stands with the system prompt `agent.v6` and the reflection prompt `reflection.v2`. Where the data goes is in [PRIVACY.md](PRIVACY.md); how the agent is built is in [AGENT_DESIGN.md](AGENT_DESIGN.md); every measured figure is in [METRICS.md](METRICS.md), and none is repeated here.

## 1. What it is

Loreweaver is a chat assistant for novelists. The author picks a world and asks a question about it ("Can fire magic be cast inside the Ice Citadel?", "How can Aria get out of the Citadel?"). The assistant reads the author's lore and the current state of the characters, and answers with options that fit the world's rules, citing the lore passages it used. It suggests; it does not decide, and it never changes the lore or the character data.

## 2. Intended users and uses

| Users                                                                                       | Intended uses                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A fiction author (alone or in a small team) who keeps a large world and has lore to consult | Finding what the world's rules say about a situation. Checking what a character carries, where they are and what they can afford. Getting options for a scene that respect both |
| The same author, while drafting                                                             | Spotting a continuity problem before it is written: an item the character does not have, a spell that costs more mana than they hold, a rule the plot breaks                    |

The product assumes the author owns the world and the lore, prepares the data in advance, and reads every answer before using it.

## 3. Out-of-scope uses

- **Writing the book.** Whole chapters and long prose are not a goal. Short options and short passages the author asks for are fine.
- **Answers about the real world, general questions and code.** The assistant is told to stay in its role and says so; it is not a general chatbot.
- **A source of truth.** The lore files and the character service are. The assistant reads them and can be wrong about them.
- **Decisions about people.** Nothing here is meant for hiring, credit, health, education or any use that affects a real person's rights. The data is fiction.
- **Training or fine-tuning on authors' data.** Not done by the product.
- **Storing or searching a manuscript.** The prose of the book stays in the author's own tools. A pasted scene is used for that answer and is not kept by the product (but see the traces in [PRIVACY.md](PRIVACY.md)).
- **Handling real personal data or secrets.** There are no accounts and no access control per author: any visitor can open any of the known worlds, so a deployment may only hold worlds that are fine to show to everyone.

## 4. Models

| Role                                                  | Model                  | Where it runs                           | Notes                                                                                     |
| ----------------------------------------------------- | ---------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Drafts the answer (the agent)                         | Claude Sonnet 5.5      | Preview and Production                  | Chosen in [ADR-0002](adr/0002-model-choice.md). Callers cannot choose the model there     |
| Drafts the answer                                     | Claude Haiku 4.5       | A developer's machine, and the CI evals | The cheap model: faster and cheaper, and weaker on rules and over-cautious on dark themes |
| Checks a draft against the world's rules (reflection) | Claude Haiku 4.5       | Every environment                       | A structured verdict; a failed answer is revised up to a limit                            |
| Turns lore and questions into vectors                 | Voyage `voyage-4-lite` | Voyage AI's service                     | Chunks and questions must use the same model                                              |
| Judges answers in the evals only                      | Claude Opus 5.5        | The eval runs, never in the product     | Stronger than the model it grades; checked against a person's labels                      |

All the language models are used as they are provided: nothing was trained or fine-tuned, and no model weights are held by the project.

## 5. How an answer is made

1. The server reads the world from the visitor's session. The model never chooses or sees it.
2. The agent asks for the character's state (a read-only call to the story service) and searches the world's lore (the nearest passages by meaning, each with a citation id).
3. It writes a draft from what the tools returned, in a system prompt that tells it to use only the passages, to cite them, to say when the lore does not cover something and to name both sides when two passages disagree.
4. A second, cheaper model checks the draft against the rules and the character's state. A draft that breaks one is revised, up to a limit; then the best draft is shown with a note of what is unresolved.
5. Code checks the answer once more: an answer that repeats the system prompt or names a world id is replaced. The answer is shown only after these steps.

## 6. Evaluation

The product is checked at several levels; the numbers and how they were measured are in [METRICS.md](METRICS.md). The evals are described in [`evals/README.md`](../evals/README.md).

| What is checked             | How                                                                                                                                                                  | What it shows, in words                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval on its own        | Labeled questions, ranking metrics                                                                                                                                   | Whether the right passages are found. Paraphrases and questions that need several passages are the weak spots                                  |
| The reflection loop         | A set of questions written to tempt the agent into breaking a rule                                                                                                   | The check catches many rule-breaking first drafts, and a revision usually fixes them                                                           |
| The whole agent, end to end | 19 cases from the seed data, graded by code (tools, items, citations) and by a stronger model against hand-written constraints                                       | Most cases pass; the ones that fail mostly need a passage that one search missed                                                               |
| The judge itself            | Ten answers labeled by a person without seeing the judge's grades, then compared                                                                                     | The judge's verdicts mostly agree with the person; ten labels are a first check, not a measurement                                             |
| Attacks (the red-team set)  | Nine cases: prompt injection direct and hidden in the lore, another world's data, a harmful request dressed as fiction, a cost attack, a dark but legitimate request | None of the attacks got through in the recorded runs, with and without the code defenses; the models resisted them on their own                |
| Every pull request          | A smoke set and the red-team set run in CI on real models                                                                                                            | A coarse alarm for a prompt that makes the agent invent lore or lets an attack through. It can miss a regression and can fail a healthy change |

## 7. Known limitations

- **Ambiguous or contradictory lore.** When two passages disagree, or the lore and the character service disagree, the assistant names both and does not pick one. It cannot tell which the author meant, and it may mis-state a conflict.
- **Lore the search does not find.** One search per kind of rule can miss the passage that decides the answer; the assistant then says the lore does not cover it, which can be wrong. Questions that need several passages are the weakest.
- **Unsupported claims are reduced, not ruled out.** The assistant is told never to invent, and the evals check it, but it can still state something the passages do not support, and it sometimes fills a gap with a story option that it labels as its own.
- **Character state can be stale or unavailable.** It says so when the service fails; it cannot know about a change the service does not have.
- **It is slower than the product goal.** The answer waits for the check, so a first token takes seconds, and the goal for the complete answer is not met (see METRICS).
- **Caution on creative requests.** The cheaper model refuses legitimate dark themes, and both models sometimes answer a creative request with background and offers instead of the scene.
- **The evals are small.** Each case is run once, the sets are small and written by one person, the judge is from the same model family as the agent and is itself a model, and the item check reads text and misses paraphrases. A pass is evidence, not a guarantee.
- **The defenses are layers, not a proof.** Copies of the system prompt are blocked, paraphrases are not; the history of a conversation is sent by the browser, so a client can forge parts of its own.
- **No accounts.** Any visitor can open any known world, and a visitor is a cookie, not a person.
- **English, fantasy prose, one author's idea of the world.** Nothing was tested in other languages or genres.

## 8. Risks and mitigations

| Risk                                                                | Mitigation                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invented lore stated as canon                                       | Answers only from retrieved passages, with citations; a reflection check; a rule to say "the lore does not cover this"; evals on missing lore                                        |
| A suggestion that breaks a rule or uses an item the character lacks | The reflection check against the rules and the character's state; code checks of items and citations in the evals                                                                    |
| Another world's data shown to the wrong author                      | The world is set by the server and put in the search query; the tools have no world parameter; a character of another world looks like a missing one; a test against a real database |
| Prompt injection through the lore or the question                   | Passages marked as data before the model reads them; the prompt tells the model to ignore instructions inside them; a code check on the answer; the red-team set                     |
| Stale or unavailable character state                                | The assistant says so and does not guess; a time bound and a circuit breaker on the service                                                                                          |
| Runaway cost from one visitor                                       | A cap on the message length, a rate limit and a daily token budget per visitor, and a cap on the length of every model reply                                                         |
| Harmful content requested through fiction                           | The models' own refusals, checked by a red-team case, with a legitimate dark request beside it to check for over-refusal                                                             |
| The author trusts a suggestion too much                             | The page says the suggestions are AI-generated and can be wrong; every claim carries its source so it can be checked                                                                 |
| Data about the author leaving the product                           | See [PRIVACY.md](PRIVACY.md): what is sent where, what is kept and for how long, and how a world's data is deleted                                                                   |

## 9. Human oversight

- **The author decides.** The assistant only suggests. The author reads each answer, can open each cited passage, can regenerate it, and marks it up or down. Nothing it says is written to the lore or to the character service.
- **The assistant admits what it does not know**: that the lore does not cover something, that a source may be stale, that two sources disagree, that an option needs a change to the story.
- **The operator watches the system.** Every run can be traced and priced; a smoke set and the red-team set run on every pull request that can change the agent; a person reads a red result. Changes to the prompt are versioned, and the version is recorded with every trace and every feedback click.
- **A person checked the judge**, and the labels are kept with the code so the check can be repeated.
- **What is not in place:** no human reviews each answer before it is shown, there is no queue of flagged answers, and the repository is on a plan where the main branch cannot be protected, so a red check does not stop a merge by itself.

## 10. Keeping this card current

Update this card when the models, the system prompt, the tools, the evals or the data flow change, and when a new limitation is found. The system prompt versions are in `apps/web/src/lib/prompts/`, the model choice in [ADR-0002](adr/0002-model-choice.md) and the measurements in [METRICS.md](METRICS.md).
