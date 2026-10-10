import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { loreChunks } from "@/db/schema";
import { EMBEDDING_DIMENSIONS } from "./constants";
import { findNearestChunks, searchLore } from "./search";

/**
 * The tenant isolation test, against a REAL Postgres with pgvector (no mocks): a query made in
 * one world can never return a chunk of another world, even when that chunk is the closest
 * vector in the whole table.
 *
 * It needs a migrated database in TEST_DATABASE_URL (locally the Docker one; in CI a Postgres
 * service). It writes only rows of its own test worlds and removes them afterwards. Never point
 * TEST_DATABASE_URL at a shared or hosted database.
 */
const url = process.env.TEST_DATABASE_URL;

// A test that is skipped by accident proves nothing. In CI, a missing database is a failure.
describe("isolation test setup", () => {
  it("has a database in CI", () => {
    if (process.env.CI) expect(url, "TEST_DATABASE_URL must be set in CI").toBeTruthy();
  });
});

/** A vector that is 1 in one position and 0 elsewhere: two different positions are perpendicular. */
const axis = (position: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === position ? 1 : 0));

describe.skipIf(!url)("lore search keeps worlds apart (real Postgres)", () => {
  const run = randomUUID().slice(0, 8);
  const worldA = `test_world_a_${run}`;
  const worldB = `test_world_b_${run}`;
  const worldEmpty = `test_world_empty_${run}`;
  const chunking = `test-isolation-${run}`;

  const client = postgres(url ?? "postgres://unused", { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  const row = (worldId: string, chunkIndex: number, content: string, embedding: number[]) => ({
    worldId,
    chunking,
    sourcePath: `data/lore/${worldId}/test.md`,
    chunkIndex,
    docType: "rule" as const,
    headingPath: `Heading ${chunkIndex}`,
    content,
    contentHash: `hash-${worldId}-${chunkIndex}`,
    embedding,
    embeddingModel: "test-model",
    tokenEstimate: 1,
  });

  beforeAll(async () => {
    await db.insert(loreChunks).values([
      // World A holds the chunk that matches the question exactly (axis 0)...
      row(worldA, 0, "A: teleportation costs 50 mana", axis(0)),
      row(worldA, 1, "A: something else", axis(1)),
      // ...and world B holds only chunks that are far from it.
      row(worldB, 0, "B: teleportation costs 80 mana", axis(2)),
      row(worldB, 1, "B: something else", axis(3)),
    ]);
  });

  afterAll(async () => {
    await db.delete(loreChunks).where(eq(loreChunks.chunking, chunking));
    await client.end();
  });

  it("returns the exact match to the world it belongs to", async () => {
    const rows = await findNearestChunks(db, {
      worldId: worldA,
      chunking,
      embedding: axis(0),
      limit: 5,
    });
    expect(rows[0].content).toBe("A: teleportation costs 50 mana");
    expect(rows[0].similarity).toBeCloseTo(1);
  });

  it("never returns world A's chunks to a query made in world B, even if they are the closest", async () => {
    // The question is exactly world A's first chunk. Asked in world B, A's chunk must not appear.
    const rows = await findNearestChunks(db, {
      worldId: worldB,
      chunking,
      embedding: axis(0),
      limit: 100,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.content).every((c) => c.startsWith("B:"))).toBe(true);
    expect(rows.some((r) => r.content.includes("50 mana"))).toBe(false);
  });

  it("holds in the other direction too", async () => {
    const rows = await findNearestChunks(db, {
      worldId: worldA,
      chunking,
      embedding: axis(2),
      limit: 100,
    });
    expect(rows.every((r) => r.content.startsWith("A:"))).toBe(true);
  });

  it("returns nothing, and does not fall back to another world, for a world without lore", async () => {
    const rows = await findNearestChunks(db, {
      worldId: worldEmpty,
      chunking,
      embedding: axis(0),
      limit: 100,
    });
    expect(rows).toEqual([]);
  });

  it("holds through the whole search function, with the world taken from its argument", async () => {
    const searchAs = (worldId: string) =>
      searchLore(
        { worldId, query: "how much does teleportation cost?", k: 8 },
        {
          embedQuery: async () => axis(0), // the question "looks like" world A's chunk
          findNearest: (args) => findNearestChunks(db, args),
          chunking,
        },
      );

    const asB = await searchAs(worldB);
    const asA = await searchAs(worldA);
    expect(asB.ok && asB.hits.map((h) => h.content)).toEqual([]); // B has nothing close enough
    expect(asA.ok && asA.hits.map((h) => h.content)).toEqual(["A: teleportation costs 50 mana"]);
  });
});
