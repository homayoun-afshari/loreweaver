<?php

declare(strict_types=1);

namespace Legacy\Middleware;

use Legacy\Json;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\Psr7\Response as SlimResponse;

/**
 * Fixed-window limit per API key (default 30 requests per minute).
 * Counters live in SQLite because the server runs several worker processes.
 */
final class RateLimit implements MiddlewareInterface
{
    public function __construct(private readonly PDO $pdo, private readonly int $limitPerMinute)
    {
    }

    public function process(Request $request, Handler $handler): Response
    {
        $keyId = (string) $request->getAttribute('key_id', 'anonymous');
        $window = intdiv(time(), 60);

        // Atomic upsert: count this request and read the new total in one statement.
        $stmt = $this->pdo->prepare(
            'INSERT INTO rate_limit (key_id, window, hits) VALUES (?, ?, 1)
             ON CONFLICT (key_id, window) DO UPDATE SET hits = hits + 1
             RETURNING hits'
        );
        $stmt->execute([$keyId, $window]);
        $hits = (int) $stmt->fetchColumn();
        $stmt->closeCursor();
        $this->pdo->prepare('DELETE FROM rate_limit WHERE window < ?')->execute([$window - 1]);

        if ($hits > $this->limitPerMinute) {
            $response = Json::error(new SlimResponse(), 429, 'rate_limited', 'Too many requests.');

            return $response->withHeader('Retry-After', (string) (60 - (time() % 60)));
        }

        return $handler->handle($request);
    }
}
