import { EMBEDDING_DIMENSIONS } from "./constants";

/**
 * Voyage AI list prices in US dollars per million tokens (provider pricing page, read 2026-10-10).
 * A real bill can be lower: new accounts get a free allowance of tokens.
 */
export const EMBEDDING_PRICE_USD_PER_MILLION_TOKENS: Record<string, number> = {
  "voyage-4-lite": 0.02,
  "voyage-4": 0.06,
  "voyage-4-large": 0.12,
};

/** Cost at list price, or undefined if we do not know the model's price. */
export function embeddingCostUsd(model: string, tokens: number): number | undefined {
  const price = EMBEDDING_PRICE_USD_PER_MILLION_TOKENS[model];
  return price === undefined ? undefined : (tokens / 1_000_000) * price;
}

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export type EmbedOptions = {
  apiKey: string;
  model: string;
  /** "document" for lore chunks, "query" for a user's question. Both use the same model. */
  inputType: "document" | "query";
  /** Texts per request. The API allows up to 1000; a smaller batch keeps retries cheap. */
  batchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Replaceable in tests, so no real network call or real waiting is needed. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type EmbedResult = {
  /** One vector per input text, in the same order. */
  vectors: number[][];
  /** Tokens the provider billed, summed over all requests. */
  totalTokens: number;
  requests: number;
};

/** Errors worth another attempt: rate limiting (429) and the provider having a bad moment (5xx). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export async function embedTexts(texts: string[], options: EmbedOptions): Promise<EmbedResult> {
  const batchSize = options.batchSize ?? 128;
  const vectors: number[][] = [];
  let totalTokens = 0;
  let requests = 0;

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const result = await embedBatch(batch, options);
    vectors.push(...result.vectors);
    totalTokens += result.tokens;
    requests += result.requests;
  }
  return { vectors, totalTokens, requests };
}

async function embedBatch(batch: string[], options: EmbedOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 4;

  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    let networkError: unknown;
    try {
      response = await fetchImpl(VOYAGE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: batch,
          model: options.model,
          input_type: options.inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
          // Fail loudly on an over-long text instead of silently embedding only its start.
          truncation: false,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      networkError = error; // A timeout or a dropped connection.
    }

    if (response?.ok) {
      return { ...parseResponse(await response.json(), batch.length), requests: attempt + 1 };
    }

    const retryable = response === undefined || RETRYABLE_STATUS.has(response.status);
    if (!retryable || attempt >= maxRetries) {
      const detail = response
        ? `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`
        : String(networkError);
      throw new Error(`Embedding request failed (${detail}).`);
    }
    // Exponential backoff (0.5 s, 1 s, 2 s, ...) plus a little random jitter, or the server's own hint.
    const retryAfter = Number(response?.headers.get("retry-after"));
    const delay = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 250;
    await sleep(delay);
  }
}

/** Checks the response has the shape we rely on, and puts the vectors back in input order. */
function parseResponse(body: unknown, expected: number) {
  const { data, usage } = body as {
    data?: { embedding: number[]; index: number }[];
    usage?: { total_tokens?: number };
  };
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error(
      `Embedding response has ${data?.length ?? "no"} vectors, expected ${expected}.`,
    );
  }
  const vectors = [...data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding has ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}.`,
      );
    }
  }
  return { vectors, tokens: usage?.total_tokens ?? 0 };
}
