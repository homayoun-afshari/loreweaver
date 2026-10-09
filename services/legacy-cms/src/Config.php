<?php

declare(strict_types=1);

namespace Legacy;

/** All settings come from environment variables, so the same image runs in dev and prod. */
final class Config
{
    public function __construct(
        public readonly string $apiKey,
        public readonly string $dbPath,
        public readonly int $rateLimitPerMinute,
        public readonly bool $simulateFlakiness,
        public readonly float $failureRate,
        public readonly int $minLatencyMs,
        public readonly int $maxLatencyMs,
    ) {
    }

    public static function fromEnv(): self
    {
        $apiKey = getenv('LEGACY_API_KEY') ?: '';
        if ($apiKey === '') {
            // Fail fast, like the web app's env loader.
            throw new \RuntimeException('LEGACY_API_KEY is required.');
        }

        return new self(
            apiKey: $apiKey,
            dbPath: getenv('LEGACY_DB_PATH') ?: __DIR__ . '/../data/legacy.sqlite',
            rateLimitPerMinute: (int) (getenv('LEGACY_RATE_LIMIT_PER_MIN') ?: 30),
            simulateFlakiness: filter_var(getenv('LEGACY_SIMULATE_FLAKINESS') ?: 'true', FILTER_VALIDATE_BOOLEAN),
            failureRate: (float) (getenv('LEGACY_FAILURE_RATE') ?: 0.05),
            minLatencyMs: (int) (getenv('LEGACY_MIN_LATENCY_MS') ?: 200),
            maxLatencyMs: (int) (getenv('LEGACY_MAX_LATENCY_MS') ?: 1500),
        );
    }
}
