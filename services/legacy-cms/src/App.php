<?php

declare(strict_types=1);

namespace Legacy;

use Legacy\Middleware\ApiKeyAuth;
use Legacy\Middleware\RateLimit;
use Legacy\Middleware\SimulatedFlakiness;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\App as SlimApp;
use Slim\Exception\HttpNotFoundException;
use Slim\Factory\AppFactory;
use Slim\Routing\RouteCollectorProxy;

final class App
{
    public static function create(Config $config): SlimApp
    {
        $pdo = Database::connect($config->dbPath);
        $repo = new CharacterRepository($pdo);

        $app = AppFactory::create();
        $app->addRoutingMiddleware();

        // Every error becomes a JSON body; internal details are logged, never sent to the client.
        $errors = $app->addErrorMiddleware(false, true, true);
        $errors->setDefaultErrorHandler(
            static function (Request $r, \Throwable $e) use ($app): Response {
                $notFound = $e instanceof HttpNotFoundException;

                return Json::error(
                    $app->getResponseFactory()->createResponse(),
                    $notFound ? 404 : 500,
                    $notFound ? 'not_found' : 'internal_error',
                    $notFound ? 'Route not found.' : 'Unexpected error.'
                );
            }
        );

        // Open health check for Docker and Cloud Run: no key, no rate limit, no flakiness.
        $app->get('/health', static fn (Request $r, Response $res): Response => Json::respond($res, ['status' => 'ok']));

        $app->group('/v1', function (RouteCollectorProxy $group) use ($repo): void {
            // GET /v1/characters/{id}/state
            $group->get('/characters/{id}/state', static function (Request $req, Response $res, array $args) use ($repo): Response {
                if (!ctype_digit($args['id'])) {
                    return Json::error($res, 400, 'bad_request', 'Character id must be a number.');
                }
                $state = $repo->findState((int) $args['id']);

                return $state === null
                    ? Json::error($res, 404, 'not_found', 'Character not found.')
                    : Json::respond($res, $state);
            });

            // GET /v1/characters?world_id=...&page=1&per_page=20
            $group->get('/characters', static function (Request $req, Response $res) use ($repo): Response {
                $q = $req->getQueryParams();
                $worldId = $q['world_id'] ?? '';
                if (!is_string($worldId) || $worldId === '') {
                    return Json::error($res, 400, 'bad_request', 'world_id is required.');
                }
                $page = max(1, (int) ($q['page'] ?? 1));
                $perPage = min(50, max(1, (int) ($q['per_page'] ?? 20)));

                $result = $repo->listByWorld($worldId, $page, $perPage);

                return Json::respond($res, [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $result['total'],
                    'total_pages' => max(1, (int) ceil($result['total'] / $perPage)),
                    'data' => $result['items'],
                ]);
            });
        })
            // Slim runs the last-added middleware first: auth, then rate limit, then flakiness.
            ->add(self::flakiness($config))
            ->add(new RateLimit($pdo, $config->rateLimitPerMinute))
            ->add(new ApiKeyAuth($config->apiKey));

        return $app;
    }

    private static function flakiness(Config $config): MiddlewareInterface
    {
        if ($config->simulateFlakiness) {
            return new SimulatedFlakiness($config->failureRate, $config->minLatencyMs, $config->maxLatencyMs);
        }

        // Flakiness switched off (used for tests): pass straight through.
        return new class implements MiddlewareInterface {
            public function process(Request $request, Handler $handler): Response
            {
                return $handler->handle($request);
            }
        };
    }
}
