// Builds the architecture diagrams in docs/diagrams/, one snapshot per day of the build.
// Every snapshot uses the same canvas and the same slot for each module, so a module never moves:
// a later snapshot only adds modules and edges, and changes what a module lists.
//
// Run from the repository root: node docs/diagrams/scripts/build.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// The snapshots. The file name is built from the title: the number, then each segment in PascalCase.
const SNAPSHOTS = [
  { day: 1, segments: ["Product Discovery", "Legacy CMS", "Scaffolding"] },
  { day: 2, segments: ["Model Layer", "Streaming", "Generative UI"] },
  { day: 3, segments: ["Lore", "Embeddings", "Retrieval"] },
  { day: 4, segments: ["Agentic Orchestration", "Reflection"] },
  { day: 5, segments: ["Observability", "Token Economics", "Performance"] },
  { day: 6, segments: ["Evaluation", "Safety", "Responsible AI"] },
];

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

const CARD_W = 260;
const CARD_H = 336;
const GAP_X = 150;
const GAP_Y = 110;
const LEFT = 40;
const TOP = 130;
const COLS = 5;
const ROWS = 4;
const WIDTH = LEFT * 2 + COLS * CARD_W + (COLS - 1) * GAP_X;
const HEIGHT = TOP + ROWS * CARD_H + (ROWS - 1) * GAP_Y + 40;
const HEADER_H = 50;
const ENV_H = 62;

const colX = (c) => LEFT + c * (CARD_W + GAP_X);
const rowY = (r) => TOP + r * (CARD_H + GAP_Y);
const cx = (c) => colX(c) + CARD_W / 2;
const right = (c) => colX(c) + CARD_W;
const bottom = (r) => rowY(r) + CARD_H;
// The middle of the gap to the right of column c, and below row r.
const gapX = (c) => right(c) + GAP_X / 2;
const gapY = (r) => bottom(r) + GAP_Y / 2;

// ---------------------------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------------------------

const INK = "#0f172a";
const TEXT = "#1e293b";
const MUTED = "#475569";
const LINE = "#475569";

// Location badges use neutral tones that no module header uses.
const LOCATIONS = {
  Core: {
    fill: "#27272a",
    text: "#ffffff",
    stroke: "none",
    meaning: "Runs inside the web app: Node locally, Vercel functions when deployed",
  },
  Docker: {
    fill: "#52606d",
    text: "#ffffff",
    stroke: "none",
    meaning: "A container on the developer's machine; a managed service when deployed",
  },
  Embedded: {
    fill: "#8a7560",
    text: "#ffffff",
    stroke: "none",
    meaning: "Lives inside another module (the SQLite file of the legacy CMS)",
  },
  External: {
    fill: "#ffffff",
    text: "#27272a",
    stroke: "#27272a",
    dash: "4 3",
    meaning: "A third-party API, called over HTTPS",
  },
  Tooling: {
    fill: "#ffffff",
    text: "#27272a",
    stroke: "#27272a",
    meaning: "Runs only on a developer's machine and in CI, never in the product",
  },
};

// ---------------------------------------------------------------------------------------------
// Modules. `from` is the first day a module exists. `tech` and `ops` are lists of
// [first day, value]: a snapshot uses the last entry whose day is not after its own.
// ---------------------------------------------------------------------------------------------

const ENV_APP = ["Node", "Vercel", "Vercel"];
const ENV_CLOUD_RUN = ["Docker", "Google Cloud", "Google Cloud"];
const ENV_POSTGRES = ["Docker", "Supabase", "Supabase"];

const MODULES = {
  legacy: {
    title: "Legacy CMS",
    slot: [0, 0],
    color: "#7c3aed",
    location: "Docker",
    from: 1,
    env: ENV_CLOUD_RUN,
    tech: [[1, ["PHP 8.4, Slim 4, Docker"]]],
    ops: [
      [
        1,
        [
          "GET /health",
          "GET /v1/characters/{id}/state",
          "GET /v1/characters?world_id&page",
          "X-API-Key, 30 requests/min",
          "Random delays and 503s",
          "OpenAPI contract",
        ],
      ],
    ],
  },
  acl: {
    title: "Anti-Corruption",
    slot: [1, 0],
    color: "#0d9488",
    location: "Core",
    from: 1,
    env: ENV_APP,
    tech: [[1, ["TypeScript, Zod, fetch"]]],
    ops: [
      [
        1,
        [
          "getCharacterState(id)",
          "Maps legacy fields to domain",
          "2 s timeout, 3 retries, backoff",
          "Circuit breaker",
          "Typed errors, never exceptions",
        ],
      ],
    ],
  },
  app: {
    title: "App",
    slot: [2, 0],
    color: "#2563eb",
    location: "Core",
    from: 1,
    env: ENV_APP,
    tech: [[1, ["Node 24, Next.js 16,", "React 19, Tailwind 4"]]],
    ops: [
      [
        1,
        [
          "Page /: “Hello, author”",
          "GET /api/health",
          "GET /api/legacy/character-state",
          "Checks env vars at startup",
        ],
      ],
      [
        2,
        [
          "Page /: the chat",
          "POST /api/chat",
          "POST /api/feedback",
          "GET /api/health",
          "GET /api/legacy/character-state",
          "Checks env vars at startup",
        ],
      ],
      [
        3,
        [
          "Page /: chat, world selector",
          "POST /api/chat",
          "GET|POST /api/session/world",
          "POST /api/feedback",
          "GET /api/health",
          "GET /api/legacy/character-state",
        ],
      ],
      [
        4,
        [
          "Page /: chat, world selector",
          "POST /api/chat: runs the graph",
          "GET|POST /api/session/world",
          "POST /api/feedback",
          "GET /api/health",
          "GET /api/legacy/character-state",
        ],
      ],
      [
        5,
        [
          "Page /: chat, world selector",
          "POST /api/chat: runs the graph",
          "429 at a visitor's limit",
          "GET|POST /api/session/world",
          "POST /api/feedback",
          "GET /api/health",
          "GET /api/legacy/character-state",
        ],
      ],
      [
        6,
        [
          "Page /: chat, world selector",
          "POST /api/chat: runs the graph",
          "429 at a limit, 413 too long",
          "GET|POST /api/session/world",
          "POST /api/feedback",
          "GET /api/health",
          "GET /api/legacy/character-state",
        ],
      ],
    ],
  },
  aisdk: {
    title: "Vercel AI SDK",
    slot: [3, 0],
    color: "#4f46e5",
    location: "Core",
    from: 2,
    env: ENV_APP,
    tech: [
      [2, ["ai, @ai-sdk/react,", "@ai-sdk/anthropic"]],
      [4, ["ai, @ai-sdk/react,", "@ai-sdk/langchain"]],
    ],
    ops: [
      [
        2,
        [
          "streamText(): model and tools",
          "useChat(): chat state",
          "Up to 3 model steps",
          "Typed tool parts to the UI",
          "Stop cancels the model call",
        ],
      ],
      [
        4,
        [
          "useChat(): chat state",
          "validateUIMessages(): history",
          "toBaseMessages(): to the graph",
          "Node updates to SSE chunks",
          "Answer sent in one part",
        ],
      ],
    ],
  },
  cards: {
    title: "Cards",
    slot: [4, 0],
    color: "#db2777",
    location: "Core",
    from: 2,
    env: ENV_APP,
    tech: [[2, ["React, shadcn/ui, Base UI,", "Tailwind, lucide"]]],
    ops: [
      [
        2,
        [
          "Character Status Card",
          "Skeleton and error states",
          "AI-generated badge",
          "Feedback: up, down, copy",
          "Stop, Regenerate, Retry",
        ],
      ],
      [
        3,
        [
          "Character Status Card",
          "Lore Citation cards",
          "Skeleton and error states",
          "World selector, AI badge",
          "Feedback: up, down, copy",
          "Stop, Regenerate, Retry",
        ],
      ],
      [
        4,
        [
          "Character Status Card",
          "Lore Citation cards",
          "Skeleton and error states",
          "World selector, AI badge",
          "Status note while checking",
          "Feedback: up, down, copy",
          "Stop, Regenerate, Retry",
        ],
      ],
      [
        5,
        [
          "Character Status Card",
          "Lore Citation cards",
          "Skeleton and error states",
          "World selector, AI badge",
          "Status note, limit message",
          "Feedback: up, down, copy",
          "Stop, Regenerate, Retry",
        ],
      ],
      [
        6,
        [
          "Character Status Card",
          "Lore Citation cards",
          "Skeleton and error states",
          "World selector, AI badge",
          "Status note, limit message",
          "Length counter (8,000 chars)",
          "Feedback, Stop, Regenerate",
        ],
      ],
    ],
  },
  stateDb: {
    title: "State Database",
    slot: [0, 1],
    color: "#d97706",
    location: "Embedded",
    from: 1,
    env: ENV_CLOUD_RUN,
    tech: [[1, ["SQLite (PDO)"]]],
    ops: [
      [
        1,
        [
          "Seeded when a container starts",
          "Table characters",
          "Reads a character by id",
          "Lists a world's characters",
          "Table rate_limit: calls per key",
        ],
      ],
    ],
  },
  tools: {
    title: "Tools",
    slot: [1, 1],
    color: "#0891b2",
    location: "Core",
    from: 2,
    env: ENV_APP,
    tech: [
      [2, ["Zod, AI SDK tool()"]],
      [4, ["Zod, LangChain tool(),", "AI SDK tool() for UI types"]],
    ],
    ops: [
      [
        2,
        [
          "fetch_character_state",
          "    (character_id)",
          "Numeric id checked by the server",
          "Results as data, not errors",
        ],
      ],
      [
        3,
        [
          "fetch_character_state",
          "    (character_id)",
          "search_lore(query, k ≤ 8)",
          "World set by the server",
          "Other worlds look missing",
          "Results as data, not errors",
        ],
      ],
      [
        4,
        [
          "fetch_character_state",
          "    (character_id)",
          "search_lore(query, k ≤ 8)",
          "World set by the server",
          "Other worlds look missing",
          "Results as data, not errors",
          "One core for both layers",
        ],
      ],
    ],
  },
  agent: {
    title: "Agent Orchestrator",
    slot: [2, 1],
    color: "#4d7c0f",
    location: "Core",
    from: 4,
    env: ENV_APP,
    tech: [[4, ["LangGraph, LangChain"]]],
    ops: [
      [
        4,
        [
          "Nodes: agent, tools, reflect",
          "≤ 2 revisions, 3 calls a draft",
          "No revision after 12 s",
          "Caveat when a limit is hit",
          "Answer sent once, when checked",
          "System prompt agent.v3",
        ],
      ],
      [
        5,
        [
          "Nodes: agent, tools, reflect",
          "≤ 2 revisions, 3 calls a draft",
          "No revision after 12 s",
          "Caveat when a limit is hit",
          "Answer sent once, when checked",
          "System prompt agent.v3",
          "Run labels for tracing",
        ],
      ],
      [
        6,
        [
          "Nodes: agent, tools, reflect",
          "≤ 2 revisions, 3 calls a draft",
          "No revision after 12 s",
          "Caveat when a limit is hit",
          "Answer sent once, when checked",
          "Lore marked as data",
          "Leaks blocked; prompt agent.v6",
        ],
      ],
    ],
  },
  reflection: {
    title: "Reflection LLM",
    slot: [3, 1],
    color: "#a21caf",
    location: "External",
    from: 4,
    env: ["Haiku", "Haiku", "Haiku"],
    tech: [[4, ["Anthropic, Claude Haiku 4.5"]]],
    ops: [
      [
        4,
        [
          "Checks draft vs. tool results",
          "Structured verdict",
          "Prompt reflection.v2",
          "Temperature 0",
          "Counts tokens",
        ],
      ],
    ],
  },
  feedbackDb: {
    title: "Feedback Database",
    slot: [4, 1],
    color: "#059669",
    location: "Docker",
    from: 2,
    env: ENV_POSTGRES,
    tech: [[2, ["PostgreSQL, Drizzle,", "postgres.js"]]],
    ops: [
      [
        2,
        [
          "Table feedback_events",
          "Appends up, down and copy",
          "Model and prompt version",
          "No text, no visitor id",
          "Row Level Security on",
        ],
      ],
    ],
  },
  embedding: {
    title: "Embedding Model",
    slot: [0, 2],
    color: "#ca8a04",
    location: "External",
    from: 3,
    env: ["voyage-4-lite", "voyage-4-lite", "voyage-4-lite"],
    tech: [[3, ["Voyage AI, REST over fetch"]]],
    ops: [
      [
        3,
        [
          "Embeds lore chunks (ingest)",
          "Embeds search questions",
          "1024 dims, normalized",
          "Batches, retries on 429/5xx",
          "Counts tokens at ingest",
        ],
      ],
    ],
  },
  vectorDb: {
    title: "Vector Database",
    slot: [1, 2],
    color: "#0369a1",
    location: "Docker",
    from: 3,
    env: ENV_POSTGRES,
    tech: [[3, ["PostgreSQL 17, pgvector,", "Drizzle"]]],
    ops: [
      [
        3,
        [
          "Table lore_chunks",
          "vector(1024) per chunk",
          "Exact cosine search, no index",
          "Filters by world_id",
          "Similarity floor",
          "Rebuilt by pnpm ingest",
        ],
      ],
    ],
  },
  reasoning: {
    title: "Reasoning LLM",
    slot: [2, 2],
    color: "#c2410c",
    location: "External",
    from: 2,
    env: ["Haiku", "Sonnet", "Sonnet"],
    tech: [[2, ["Anthropic, Claude Haiku 4.5,", "Claude Sonnet 5.5"]]],
    ops: [
      [2, ["Streams the answer", "Chooses tool calls", "Counts tokens"]],
      [
        4,
        [
          "Chooses tool calls",
          "Writes and revises drafts",
          "At most 1,024 tokens a call",
          "Streaming off: text held back",
          "Counts tokens",
        ],
      ],
      [
        5,
        [
          "Chooses tool calls",
          "Writes and revises drafts",
          "At most 1,024 tokens a call",
          "Streaming off: text held back",
          "Prompt caching (Sonnet)",
          "Counts cached tokens apart",
        ],
      ],
    ],
  },
  observability: {
    title: "Observability",
    slot: [3, 2],
    color: "#b91c1c",
    location: "External",
    from: 5,
    env: ["Dev project", "Dev project", "Prod project"],
    tech: [[5, ["LangSmith (EU), langsmith"]]],
    ops: [
      [
        5,
        [
          "Traces every graph run",
          "env, model, prompt_version",
          "Tokens, cost, latency",
          "Sent after the response",
          "Read by pnpm cost:report",
        ],
      ],
      [
        6,
        [
          "Traces every graph run",
          "env, model, prompt_version",
          "Tokens, cost, latency",
          "Sent after the response",
          "Read by pnpm cost:report",
          "Off in CI and in the evals",
        ],
      ],
    ],
  },
  usageDb: {
    title: "Usage Database",
    slot: [4, 2],
    color: "#047857",
    location: "Docker",
    from: 5,
    env: ENV_POSTGRES,
    tech: [[5, ["PostgreSQL, Drizzle,", "postgres.js"]]],
    ops: [
      [
        5,
        [
          "Table usage_events",
          "One row per accepted request",
          "Tokens, cost, latency",
          "Rate limit per visitor",
          "Daily token budget",
          "Fails open on a DB error",
        ],
      ],
    ],
  },
  evals: {
    title: "Evals",
    slot: [1, 3],
    color: "#be123c",
    location: "Tooling",
    from: 6,
    env: ["Node", "GitHub CI", "—"],
    tech: [[6, ["tsx, Claude Opus 5.5 judge,", "GitHub Actions"]]],
    ops: [
      [
        6,
        [
          "pnpm eval: cases, code + judge",
          "pnpm eval:redteam: attacks",
          "pnpm eval:labels: judge check",
          "pnpm eval:retrieval: search",
          "CI gate: smoke + red team",
        ],
      ],
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Edges: a polyline, the days it exists, its label and where the label sits.
// `both` draws an arrow at each end. Label positions: [x, y] is the label's center.
// ---------------------------------------------------------------------------------------------

const ROW1_EDGE_Y = rowY(0) + 110;
const ROW2_EDGE_Y = rowY(1) + 110;
const above = (y) => y - 26;

const EDGES = [
  // Row 1, left to right.
  {
    days: [1, 6],
    points: [
      [right(0), ROW1_EDGE_Y],
      [colX(1), ROW1_EDGE_Y],
    ],
    label: ["REST API", "HTTP + JSON, API key"],
    at: [gapX(0), above(ROW1_EDGE_Y)],
  },
  {
    days: [1, 6],
    points: [
      [right(1), ROW1_EDGE_Y],
      [colX(2), ROW1_EDGE_Y],
    ],
    label: ["In-process", "function calls"],
    at: [gapX(1), above(ROW1_EDGE_Y)],
  },
  {
    days: [2, 6],
    points: [
      [right(2), ROW1_EDGE_Y],
      [colX(3), ROW1_EDGE_Y],
    ],
    label: ["In-process", "library calls"],
    at: [gapX(2), above(ROW1_EDGE_Y)],
  },
  {
    days: [2, 6],
    points: [
      [right(3), ROW1_EDGE_Y],
      [colX(4), ROW1_EDGE_Y],
    ],
    label: ["UI parts", "React props"],
    at: [gapX(3), above(ROW1_EDGE_Y)],
  },

  // Row 1 to row 2.
  {
    days: [1, 6],
    points: [
      [cx(0), bottom(0)],
      [cx(0), rowY(1)],
    ],
    label: ["SQL", "PDO SQLite"],
    side: "right",
  },
  {
    days: [2, 6],
    points: [
      [cx(1), bottom(0)],
      [cx(1), rowY(1)],
    ],
    label: ["Function calls", "legacy client"],
    side: "right",
  },
  {
    days: [4, 6],
    points: [
      [cx(2), bottom(0)],
      [cx(2), rowY(1)],
    ],
    label: ["Graph run", "node updates"],
    side: "left",
  },
  {
    days: [2, 6],
    points: [
      [cx(4), bottom(0)],
      [cx(4), rowY(1)],
    ],
    label: ["POST /api/feedback", "SQL via Drizzle"],
    side: "right",
  },

  // Days 2 and 3: the AI SDK runs the model and the tools itself, through the empty slots of
  // the orchestrator and the reflection model.
  {
    days: [2, 3],
    points: [
      [right(1), ROW2_EDGE_Y],
      [cx(3) - 50, ROW2_EDGE_Y],
      [cx(3) - 50, bottom(0)],
    ],
    label: ["Tool calls", "in-process"],
    at: [gapX(1), above(ROW2_EDGE_Y)],
  },
  {
    days: [2, 3],
    points: [
      [cx(3) + 50, bottom(0)],
      [cx(3) + 50, rowY(2) + CARD_H / 2],
      [right(2), rowY(2) + CARD_H / 2],
    ],
    label: ["HTTPS", "Messages API"],
    at: [cx(3) + 50, gapY(1)],
  },

  // Row 2, from day 4.
  {
    days: [4, 6],
    points: [
      [right(1), ROW2_EDGE_Y],
      [colX(2), ROW2_EDGE_Y],
    ],
    label: ["Tool calls", "in-process"],
    at: [gapX(1), above(ROW2_EDGE_Y)],
  },
  {
    days: [4, 6],
    points: [
      [right(2), ROW2_EDGE_Y],
      [colX(3), ROW2_EDGE_Y],
    ],
    label: ["HTTPS", "Messages API"],
    at: [gapX(2), above(ROW2_EDGE_Y)],
  },

  // Row 2 to row 3.
  {
    days: [3, 6],
    points: [
      [cx(1), bottom(1)],
      [cx(1), rowY(2)],
    ],
    label: ["SQL", "pgvector, Drizzle"],
    side: "right",
  },
  {
    days: [4, 6],
    points: [
      [cx(2), bottom(1)],
      [cx(2), rowY(2)],
    ],
    label: ["HTTPS", "Messages API"],
    side: "right",
  },
  {
    days: [3, 6],
    points: [
      [colX(1), rowY(1) + 250],
      [gapX(0), rowY(1) + 250],
      [gapX(0), rowY(2) + CARD_H / 2],
      [right(0), rowY(2) + CARD_H / 2],
    ],
    label: ["HTTPS", "Embeddings API"],
    at: [gapX(0), gapY(1)],
  },
  {
    days: [5, 6],
    both: false,
    points: [
      [right(2), rowY(1) + 250],
      [gapX(2), rowY(1) + 250],
      [gapX(2), rowY(2) + CARD_H / 2],
      [colX(3), rowY(2) + CARD_H / 2],
    ],
    label: ["HTTPS", "trace export"],
    at: [gapX(2), gapY(1)],
  },
  {
    days: [5, 6],
    points: [
      [cx(2) + 70, bottom(0)],
      [cx(2) + 70, gapY(0)],
      [gapX(3), gapY(0)],
      [gapX(3), rowY(2) + CARD_H / 2],
      [colX(4), rowY(2) + CARD_H / 2],
    ],
    label: ["SQL", "usage guard, Drizzle"],
    at: [gapX(3), gapY(1)],
  },

  // Row 4: the evals.
  {
    days: [6, 6],
    points: [
      [cx(1), bottom(2)],
      [cx(1), rowY(3)],
    ],
    label: ["SQL", "test world, search"],
    side: "right",
  },
  {
    days: [6, 6],
    points: [
      [right(1), rowY(3) + CARD_H / 2],
      [gapX(1), rowY(3) + CARD_H / 2],
      [gapX(1), rowY(1) + 270],
      [colX(2), rowY(1) + 270],
    ],
    label: ["In-process", "the real graph"],
    at: [gapX(1), gapY(2)],
  },
];

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pick = (list, day) => list.filter(([from]) => from <= day).at(-1)[1];
// A rough width of a text in the diagram's sans-serif font, for sizing pills and labels.
const textWidth = (s, size) => s.length * size * 0.56;

function badge(x, y, name) {
  const loc = LOCATIONS[name];
  const w = Math.round(textWidth(name, 12) + 22);
  const stroke =
    loc.stroke === "none"
      ? `stroke="#ffffff" stroke-width="2"`
      : `stroke="${loc.stroke}" stroke-width="1.5"${loc.dash ? ` stroke-dasharray="${loc.dash}"` : ""}`;
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="24" rx="12" fill="${loc.fill}" ${stroke}/>`,
    `<text x="${x + w / 2}" y="${y + 16.5}" text-anchor="middle" font-size="12" font-weight="700" fill="${loc.text}">${esc(name)}</text>`,
  ].join("\n  ");
}

function card(mod, day) {
  const [c, r] = mod.slot;
  const x = colX(c);
  const y = rowY(r);
  const tech = pick(mod.tech, day);
  const ops = pick(mod.ops, day);
  const out = [];
  out.push(`<!-- ${mod.title} -->`);
  out.push(
    `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="14" fill="#ffffff" filter="url(#shadow)"/>`,
  );
  out.push(
    `<path d="M${x},${y + HEADER_H} L${x},${y + 14} Q${x},${y} ${x + 14},${y} L${x + CARD_W - 14},${y} Q${x + CARD_W},${y} ${x + CARD_W},${y + 14} L${x + CARD_W},${y + HEADER_H} Z" fill="${mod.color}"/>`,
  );
  out.push(
    `<text x="${x + CARD_W / 2}" y="${y + 32}" text-anchor="middle" font-size="19" font-weight="700" fill="#ffffff">${esc(mod.title)}</text>`,
  );
  tech.forEach((line, i) => {
    out.push(
      `<text x="${x + CARD_W / 2}" y="${y + 76 + i * 18}" text-anchor="middle" font-size="13.5" fill="${MUTED}">${esc(line)}</text>`,
    );
  });
  const sepY = y + 76 + (tech.length - 1) * 18 + 14;
  out.push(
    `<line x1="${x + 20}" y1="${sepY}" x2="${x + CARD_W - 20}" y2="${sepY}" stroke="#e2e8f0" stroke-width="1.5"/>`,
  );
  ops.forEach((line, i) => {
    // A line that starts with spaces continues the previous one and gets no bullet.
    const continued = line.startsWith(" ");
    const text = continued ? line.trim() : `- ${line}`;
    out.push(
      `<text x="${x + (continued ? 34 : 20)}" y="${sepY + 26 + i * 20}" font-size="13" fill="${TEXT}">${esc(text)}</text>`,
    );
  });
  const envY = y + CARD_H - ENV_H;
  out.push(
    `<path d="M${x},${envY} L${x + CARD_W},${envY} L${x + CARD_W},${y + CARD_H - 14} Q${x + CARD_W},${y + CARD_H} ${x + CARD_W - 14},${y + CARD_H} L${x + 14},${y + CARD_H} Q${x},${y + CARD_H} ${x},${y + CARD_H - 14} Z" fill="#f1f5f9"/>`,
  );
  ["DEV", "PREV", "PROD"].forEach((name, i) => {
    const ex = x + (CARD_W * (2 * i + 1)) / 6;
    out.push(
      `<text x="${ex}" y="${envY + 20}" text-anchor="middle" font-size="11" font-weight="700" fill="${mod.color}">${name}</text>`,
    );
    out.push(
      `<text x="${ex}" y="${envY + 44}" text-anchor="middle" font-size="11" fill="${TEXT}">${esc(mod.env[i])}</text>`,
    );
  });
  out.push(badge(x + 12, y - 12, mod.location));
  return out.join("\n  ");
}

function label(lines, [lx, ly]) {
  const w = Math.round(Math.max(...lines.map((l, i) => textWidth(l, i === 0 ? 11 : 10.5))) + 16);
  const h = 32;
  return [
    `<rect x="${lx - w / 2}" y="${ly - h / 2}" width="${w}" height="${h}" rx="7" fill="#ffffff" fill-opacity="0.88" stroke="#cbd5e1"/>`,
    `<text x="${lx}" y="${ly - 2}" text-anchor="middle" font-size="11" font-weight="700" fill="#334155">${esc(lines[0])}</text>`,
    `<text x="${lx}" y="${ly + 11}" text-anchor="middle" font-size="10.5" fill="${MUTED}">${esc(lines[1])}</text>`,
  ].join("\n  ");
}

function edge(e) {
  const pts = e.points.map(([x, y]) => `${x},${y}`).join(" ");
  const both = e.both !== false;
  const out = [
    `<polyline points="${pts}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"${both ? ` marker-start="url(#arrow)"` : ""} marker-end="url(#arrow)"/>`,
  ];
  let at = e.at;
  if (!at) {
    // A vertical edge between two rows: the label sits beside the line, in the gap.
    const [[x, y1], [, y2]] = e.points;
    const w = Math.max(...e.label.map((l, i) => textWidth(l, i === 0 ? 11 : 10.5))) + 16;
    at = [e.side === "left" ? x - 10 - w / 2 : x + 10 + w / 2, (y1 + y2) / 2];
  }
  out.push(label(e.label, at));
  return out.join("\n  ");
}

function legend() {
  const x = colX(2);
  const y = rowY(3) + 6;
  const w = right(4) - x;
  const h = CARD_H - 12;
  const out = [];
  out.push(`<!-- Legend -->`);
  out.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#ffffff" fill-opacity="0.7" stroke="#cbd5e1"/>`,
  );
  out.push(
    `<text x="${x + 28}" y="${y + 40}" font-size="16" font-weight="700" fill="${INK}">Legend</text>`,
  );
  out.push(
    `<text x="${x + 28}" y="${y + 68}" font-size="13" font-weight="700" fill="${MUTED}">Location (the badge on each module)</text>`,
  );
  Object.entries(LOCATIONS).forEach(([name, loc], i) => {
    const ry = y + 86 + i * 34;
    out.push(badge(x + 28, ry, name));
    out.push(
      `<text x="${x + 140}" y="${ry + 16.5}" font-size="13" fill="${TEXT}">${esc(loc.meaning)}</text>`,
    );
  });
  const ry = y + 86 + 5 * 34 + 20;
  out.push(
    `<text x="${x + 28}" y="${ry}" font-size="13" fill="${TEXT}"><tspan font-weight="700">DEV, PREV, PROD:</tspan> what the module runs on in development, Preview and Production.</text>`,
  );
  out.push(
    `<line x1="${x + 28}" y1="${ry + 26}" x2="${x + 92}" y2="${ry + 26}" stroke="${LINE}" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>`,
  );
  out.push(
    `<text x="${x + 104}" y="${ry + 30}" font-size="13" fill="${TEXT}">Who talks to whom; the label names the protocol and how.</text>`,
  );
  return out.join("\n  ");
}

function svg(snapshot) {
  const { day, segments } = snapshot;
  const number = String(day).padStart(2, "0");
  const title = `${number} · ${segments.slice(0, -1).join(", ")}${segments.length > 1 ? " & " : ""}${segments.at(-1)}`;
  const modules = Object.values(MODULES).filter((m) => m.from <= day);
  const edges = EDGES.filter((e) => e.days[0] <= day && day <= e.days[1]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif">
  <title>${esc(title)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f8fafc"/>
      <stop offset="1" stop-color="#eef2f9"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#0f172a" flood-opacity="0.14"/>
    </filter>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${LINE}"/>
    </marker>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <text x="${WIDTH / 2}" y="58" text-anchor="middle" font-size="26" font-weight="700" fill="${INK}">${esc(title)}</text>
  <line x1="${WIDTH / 2 - 100}" y1="74" x2="${WIDTH / 2 + 100}" y2="74" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>

  ${modules.map((m) => card(m, day)).join("\n\n  ")}

  <!-- Connections -->
  ${edges.map(edge).join("\n\n  ")}

  ${legend()}
</svg>
`;
}

for (const snapshot of SNAPSHOTS) {
  const number = String(snapshot.day).padStart(2, "0");
  const file = `${number}_${snapshot.segments.map((s) => s.replace(/\s+/g, "")).join("_")}.svg`;
  writeFileSync(join(OUT_DIR, file), svg(snapshot));
  console.log(`Wrote docs/diagrams/${file}`);
}
