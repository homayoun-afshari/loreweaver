<?php

declare(strict_types=1);

namespace Legacy\Middleware;

use Legacy\Json;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\Psr7\Response as SlimResponse;

/** Rejects requests without the right X-API-Key header. */
final class ApiKeyAuth implements MiddlewareInterface
{
    public function __construct(private readonly string $apiKey)
    {
    }

    public function process(Request $request, Handler $handler): Response
    {
        $given = $request->getHeaderLine('X-API-Key');
        // hash_equals compares in constant time, so response timing doesn't leak the key.
        if ($given === '' || !hash_equals($this->apiKey, $given)) {
            return Json::error(new SlimResponse(), 401, 'unauthorized', 'Missing or invalid X-API-Key.');
        }

        // Pass a non-secret identifier of the key on, for rate limiting.
        return $handler->handle($request->withAttribute('key_id', substr(hash('sha256', $given), 0, 16)));
    }
}
