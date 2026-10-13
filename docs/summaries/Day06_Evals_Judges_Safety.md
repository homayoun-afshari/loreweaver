# Day 6: Evals, Judges, and Safety

The full account is in the [Day 6 report](../reports/day-6.md), and every measured figure is in [METRICS.md](../METRICS.md).

## Tasks Performed

- **Evals:** an end-to-end eval of 19 cases that drove three versions of the system prompt, and a red-team set of nine attacks.
- **Judges:** a stronger model that grades every answer against hand-written constraints, checked against a person's labels.
- **Safety:** defenses in code, a cap on the length of a message, a CI gate on every pull request that can change the agent, and the responsible-AI documents.

## Documents Involved

- **Agent Design:** [updated](../AGENT_DESIGN.md) with the guardrails that do not depend on the model behaving.
- **System Card:** [what the agent is for and not for](../SYSTEM_CARD.md), its models, how it was checked, its limits and who stays in charge.
- **Privacy:** [where an author's data goes](../PRIVACY.md), what is stored and for how long, and how a world's data is deleted.
- **Architecture Diagram:** [the evals and the judge model](Day06_Evals_Judges_Safety.svg).
- **Report:** [evaluation, safety and responsible AI](../reports/day-6.md).
- **Metrics:** Updated.

## Decisions Made

- **Two Graders:** code checks the tools, items and citations, the judge checks faithfulness and constraints, and a case passes only when both agree.
- **Stronger Judge:** Claude Opus 5.5 grades the agent, with structured outputs, and its hand labels are kept with the code.
- **Defenses in Code:** lore marked as data and a check on the answer, inside the agent node rather than a separate guard node.
- **Message Cap:** at most 8,000 characters, with a counter in the text box and HTTP 413 from the server.
- **CI Gate:** Haiku as the agent with the Opus judge, failing on low mean faithfulness or any successful attack; a coarse alarm, re-run once when red.

## Metrics Measured

- **End-to-End Eval:** the pass rate and faithfulness of the 19 cases for each prompt version.
- **Judge Agreement:** how often the judge reaches the same verdict as a person.
- **Red Team:** which attacks get through, with and without the code defenses, and how often a legitimate dark request is refused.
- **CI Gate Calibration:** the smoke set's faithfulness on healthy and broken prompts, and what the gate did on GitHub.
- **Model Spend:** the model credit the day used, by group of work.
