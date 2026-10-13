# Summary of the days

Loreweaver was built over seven days. The core product was built in Days 1 to 6, summarized below; each day has a full report in [`reports/`](reports/). Every measured figure is in [METRICS.md](METRICS.md), so this page only names what was measured.

<table>
<thead>
<tr>
<th>Day</th>
<th>Tasks Performed</th>
<th>Documents Involved</th>
<th>Decisions Made</th>
<th>Metrics Measured</th>
</tr>
</thead>
<tbody>

<tr>
<td><a href="reports/day-1.md">1</a></td>
<td>
<ul>
<li><b>Product Discovery:</b> the problem, the personas, the scope and non-goals, and the success metrics with their guardrail targets.</li>
<li><b>Scaffolding:</b> a pnpm monorepo with a strict TypeScript Next.js app, a typed environment loader, pinned versions and CI on every pull request.</li>
<li><b>Legacy CMS:</b> a PHP service that owns character state, with an API key, a rate limit and simulated failures, and a typed client with a timeout, retries and a circuit breaker.</li>
<li><b>Walking Skeleton:</b> a first page and a health route on Vercel, the CMS on Google Cloud Run, and a preview deployment for every pull request.</li>
</ul>
</td>
<td>
<ul>
<li><b>ADR:</b> <a href="adr/0001-standalone-legacy-service.md">ADR-0001</a>, character state in a stand-alone legacy service, and how its data gets in.</li>
<li><b>PRD:</b> <a href="PRD.md">the product requirements</a>: problem, personas, scope, non-goals, success metrics and risks.</li>
<li><b>Architecture Diagram:</b> <a href="diagrams/01_ProductDiscovery_Scaffolding_LegacyCMS_WalkingSkeleton.svg">the deployed skeleton</a>, with the web app and the legacy CMS.</li>
<li><b>Report:</b> <a href="reports/day-1.md">discovery, scaffolding and the legacy layer</a>.</li>
<li><b>Metrics:</b> <a href="METRICS.md">created</a> to hold every measured figure, each with its setup, results, findings, caveats and how to reproduce it.</li>
</ul>
</td>
<td>
<ul>
<li><b>Stand-alone Legacy Service:</b> character state is owned by a separate service with its own SQLite store and REST API, not by the app database.</li>
<li><b>Anti-Corruption Layer:</b> the app reaches the CMS only through a client that validates, maps and retries, and reports stale data instead of guessing.</li>
<li><b>Seed Snapshot:</b> the character data is a fixed seed, so every new container starts from the same state.</li>
<li><b>Hosting:</b> the web app on Vercel and the CMS on Cloud Run in <code>europe-west1</code>, with its API key in Secret Manager.</li>
</ul>
</td>
<td>
<ul>
<li><b>Legacy CMS:</b> the error rate and latency of the service on its own, under its simulated delays and failures.</li>
<li><b>Legacy Client:</b> the success rate after retries, the attempts per call and the latency through the anti-corruption layer.</li>
</ul>
</td>
</tr>

<tr>
<td><a href="reports/day-2.md">2</a></td>
<td>
<ul>
<li><b>UI Design:</b> a streaming chat page with Stop and Regenerate, the Character Status Card with its loading, loaded and error states, feedback buttons and an AI-generated label.</li>
<li><b>Agent v1:</b> a chat route that streams Claude's answer, with request validation, masked provider errors, a model chosen per environment and a versioned system prompt.</li>
<li><b>Tools v1:</b> <code>fetch_character_state</code>, which reads a character's live state from the legacy CMS.</li>
</ul>
</td>
<td>
<ul>
<li><b>ADR:</b> <a href="adr/0002-model-choice.md">ADR-0002</a>, the agent's model in each environment.</li>
<li><b>Benchmark:</b> <a href="BENCHMARK.md">the model benchmark</a>: its scope, the five prompts, the scoring rubric and every answer.</li>
<li><b>Architecture Diagram:</b> <a href="diagrams/02_UIDesign_Agentv1_Toolsv1.svg">the chat, the model layer, the first tool and the feedback database</a>.</li>
<li><b>Report:</b> <a href="reports/day-2.md">model layer, streaming and Generative UI</a>.</li>
<li><b>Metrics:</b> Updated.</li>
</ul>
</td>
<td>
<ul>
<li><b>Model per Environment:</b> Claude Haiku 4.5 in development and Claude Sonnet 5.5 in Preview and Production, chosen mainly on quality; a request cannot change it there.</li>
<li><b>State from the Tool Only:</b> the model never invents character state, and the card shows the CMS data as received.</li>
<li><b>Feedback Without Text:</b> thumbs and copy clicks are stored in Postgres with ids, the model and the prompt version, never the text.</li>
<li><b>Versioned Prompt:</b> the system prompt lives in a versioned file, so every answer can be tied to its version.</li>
</ul>
</td>
<td>
<ul>
<li><b>Model Benchmark:</b> time to first token, total latency, output tokens, cost and quality of two models on the same five prompts.</li>
<li><b>Time to First UI:</b> when the stream starts, the card appears and the first token and the full answer arrive, locally and on Production.</li>
</ul>
</td>
</tr>

<tr>
<td><a href="reports/day-3.md">3</a></td>
<td>
<ul>
<li><b>LoreBible:</b> the canon of two worlds as Markdown files, in a documented format.</li>
<li><b>RAG:</b> <code>pnpm ingest</code>, which cuts the lore at its headings, embeds it with Voyage AI and stores it in Postgres with pgvector, safe to run again; and a labeled question set that scores the search with no model.</li>
<li><b>Tools v2:</b> <code>search_lore</code>, which returns the passages that answer a question with citation ids, shown as Lore Citation cards, with every lookup limited to the visitor's world.</li>
</ul>
</td>
<td>
<ul>
<li><b>ADR:</b> <a href="adr/0003-chunking-and-retrieval.md">ADR-0003</a>, the lore as data, chunking, the embedding model, vector search and keeping worlds apart.</li>
<li><b>PRD:</b> <a href="PRD.md">updated</a> with a new non-goal: the author's manuscript is neither stored nor searched.</li>
<li><b>Architecture Diagram:</b> <a href="diagrams/03_LoreBible_RAG_Toolsv2.svg">the lore, its ingestion, the vector database and the search tool</a>.</li>
<li><b>Report:</b> <a href="reports/day-3.md">lore, embeddings and retrieval</a>.</li>
<li><b>Metrics:</b> Updated.</li>
</ul>
</td>
<td>
<ul>
<li><b>Lore as a Snapshot:</b> the files are the source of truth, the vector table is derived from them, and the product never changes the lore.</li>
<li><b>Chunking at Headings:</b> <code>heading-800</code> is the default, and the heading path stays in the embedded text.</li>
<li><b>One Embedding Model:</b> the same model embeds chunks and questions, and changing it re-embeds everything.</li>
<li><b>Exact Vector Search:</b> cosine similarity in Postgres with no vector index, the top 3 passages, and a similarity floor of 0.30.</li>
<li><b>World Isolation:</b> the world comes from a server-side cookie and sits in the SQL <code>WHERE</code> clause; the tools have no world parameter.</li>
</ul>
</td>
<td>
<ul>
<li><b>Retrieval Quality:</b> recall, precision, MRR and nDCG at 3 for three chunking configurations, on the labeled question set.</li>
<li><b>Similarity Floor:</b> how many questions with and without an answer each floor silences.</li>
<li><b>Retrieval Latency:</b> the time to embed the question and to search the vectors.</li>
<li><b>Ingestion Cost:</b> the tokens billed, the cost, the time and the table size of indexing the lore.</li>
<li><b>Search Tool on Production:</b> the time of the <code>search_lore</code> tool on the deployed app, compared with local.</li>
</ul>
</td>
</tr>

<tr>
<td><a href="reports/day-4.md">4</a></td>
<td>
<ul>
<li><b>State Graph:</b> a LangGraph graph with agent, tools and reflect nodes, where a second model checks every draft against the tool results, bounded by a revision limit and a time limit.</li>
<li><b>Agent v2:</b> the chat route runs the graph, shows the cards and a status note as it works and sends the checked answer once; a shorter-answer prompt version and ten prompts that tempt a rule break.</li>
</ul>
</td>
<td>
<ul>
<li><b>ADR:</b> <a href="adr/0004-orchestration-vs-ui-streaming.md">ADR-0004</a>, orchestration apart from UI streaming, and no checkpointer.</li>
<li><b>Agent Design:</b> <a href="AGENT_DESIGN.md">the agent's design</a>: the graph, its state, its bounds, what reflection checks and what reaches the author.</li>
<li><b>Architecture Diagram:</b> <a href="diagrams/04_StateGraph_Agentv2.svg">the agent orchestrator and the reflection model</a>.</li>
<li><b>Report:</b> <a href="reports/day-4.md">agentic orchestration with LangGraph</a>.</li>
<li><b>Metrics:</b> Updated.</li>
</ul>
</td>
<td>
<ul>
<li><b>Orchestration Apart from Streaming:</b> LangGraph owns state and control flow, and the Vercel AI SDK owns transport and the UI.</li>
<li><b>No Checkpointer:</b> the graph keeps nothing between requests, and the browser sends the conversation.</li>
<li><b>Bounded Loops:</b> at most two revisions by default and none after 12 seconds; the best draft then goes out with a caveat built by code.</li>
<li><b>Reflection on Evidence:</b> a cheaper model at temperature 0 checks the draft only against this run's tool results.</li>
<li><b>Answer Sent Once:</b> draft text and verdicts never leave the server.</li>
</ul>
</td>
<td>
<ul>
<li><b>Rule Violations:</b> how often first drafts and final answers break a rule, according to the checker.</li>
<li><b>Reflection Loop:</b> the revisions per run and how each run ended.</li>
<li><b>Reflection Overhead:</b> the latency and cost per query, and the share added by the checks and revisions.</li>
</ul>
</td>
</tr>

<tr>
<td><a href="reports/day-5.md">5</a></td>
<td>
<ul>
<li><b>Observability:</b> every agent run traced in LangSmith, labeled with the environment, the model and the prompt version.</li>
<li><b>Cost Optimization:</b> <code>pnpm cost:report</code>, which prices every model call from the traces, and prompt caching of the tool definitions and the system prompt.</li>
<li><b>Guardrails:</b> a usage table, a visitor cookie, a rate limit and a daily token budget per visitor, with a clear message and no model call over a limit.</li>
</ul>
</td>
<td>
<ul>
<li><b>ADR:</b> <a href="adr/0002-model-choice.md">ADR-0002</a> updated: caching was tried and the p95 latency is still above its goal, so the model choice is to be revisited.</li>
<li><b>Architecture Diagram:</b> <a href="diagrams/05_Observability_CostOptimization_Guardrails.svg">tracing in LangSmith and the usage database</a>.</li>
<li><b>Report:</b> <a href="reports/day-5.md">observability, token economics and performance</a>, including the decisions behind the limits.</li>
<li><b>Metrics:</b> Updated.</li>
</ul>
</td>
<td>
<ul>
<li><b>Tracing Setup:</b> LangSmith in the EU region, one project for development and Preview and one for Production, with traces sent after the response.</li>
<li><b>Pricing per Call:</b> every model call is priced by the model that made it, with the prices kept in code with their date.</li>
<li><b>One Optimization:</b> prompt caching of the drafting model, which helps Sonnet only.</li>
<li><b>Visitor Limits:</b> a random visitor id in an HttpOnly cookie, 10 requests a minute and 200,000 tokens a UTC day, checked before the agent runs.</li>
<li><b>Fail Open:</b> if the usage database fails, the request goes through and the failure is logged.</li>
</ul>
</td>
<td>
<ul>
<li><b>Cost per Query:</b> the tokens and cost of a question by kind of token and by step, and a monthly projection.</li>
<li><b>Latency and Time to First Token:</b> how long a question takes through the graph and when its first word arrives, compared with Day 2.</li>
<li><b>Prompt Caching:</b> the cost, cache hit rate, time to first token and latency before and after caching.</li>
</ul>
</td>
</tr>

<tr>
<td><a href="reports/day-6.md">6</a></td>
<td>
<ul>
<li><b>Evals:</b> an end-to-end eval of 19 cases that drove three versions of the system prompt, and a red-team set of nine attacks.</li>
<li><b>Judges:</b> a stronger model that grades every answer against hand-written constraints, checked against a person's labels.</li>
<li><b>Safety:</b> defenses in code, a cap on the length of a message, a CI gate on every pull request that can change the agent, and the responsible-AI documents.</li>
</ul>
</td>
<td>
<ul>
<li><b>Agent Design:</b> <a href="AGENT_DESIGN.md">updated</a> with the guardrails that do not depend on the model behaving.</li>
<li><b>System Card:</b> <a href="SYSTEM_CARD.md">what the agent is for and not for</a>, its models, how it was checked, its limits and who stays in charge.</li>
<li><b>Privacy:</b> <a href="PRIVACY.md">where an author's data goes</a>, what is stored and for how long, and how a world's data is deleted.</li>
<li><b>Architecture Diagram:</b> <a href="diagrams/06_Evals_Judges_Safety.svg">the evals and the judge model</a>.</li>
<li><b>Report:</b> <a href="reports/day-6.md">evaluation, safety and responsible AI</a>.</li>
<li><b>Metrics:</b> Updated.</li>
</ul>
</td>
<td>
<ul>
<li><b>Two Graders:</b> code checks the tools, items and citations, the judge checks faithfulness and constraints, and a case passes only when both agree.</li>
<li><b>Stronger Judge:</b> Claude Opus 5.5 grades the agent, with structured outputs, and its hand labels are kept with the code.</li>
<li><b>Defenses in Code:</b> lore marked as data and a check on the answer, inside the agent node rather than a separate guard node.</li>
<li><b>Message Cap:</b> at most 8,000 characters, with a counter in the text box and HTTP 413 from the server.</li>
<li><b>CI Gate:</b> Haiku as the agent with the Opus judge, failing on low mean faithfulness or any successful attack; a coarse alarm, re-run once when red.</li>
</ul>
</td>
<td>
<ul>
<li><b>End-to-End Eval:</b> the pass rate and faithfulness of the 19 cases for each prompt version.</li>
<li><b>Judge Agreement:</b> how often the judge reaches the same verdict as a person.</li>
<li><b>Red Team:</b> which attacks get through, with and without the code defenses, and how often a legitimate dark request is refused.</li>
<li><b>CI Gate Calibration:</b> the smoke set's faithfulness on healthy and broken prompts, and what the gate did on GitHub.</li>
<li><b>Model Spend:</b> the model credit the day used, by group of work.</li>
</ul>
</td>
</tr>

</tbody>
</table>
