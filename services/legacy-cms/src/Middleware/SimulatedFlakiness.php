<?php

declare(strict_types=1);

namespace Legacy\Middleware;

use Legacy\Json;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\Psr7\Response as SlimResponse;

/** Makes the service behave like a real legacy system: slow, and sometimes down. */
final class SimulatedFlakiness implements MiddlewareInterface
{
    public function __construct(
        private readonly float $failureRate,
        private readonly int $minLatencyMs,
        private readonly int $maxLatencyMs,
    ) {
    }

    public function process(Request $request, Handler $handler): Response
    {
        usleep(random_int($this->minLatencyMs, $this->maxLatencyMs) * 1000);

        if (random_int(1, 10000) <= (int) round($this->failureRate * 10000)) {
            $response = Json::error(new SlimResponse(), 503, 'service_unavailable', 'Legacy system is busy. Try again.');

            return $response->withHeader('Retry-After', '1');
        }

        return $handler->handle($request);
    }
}
