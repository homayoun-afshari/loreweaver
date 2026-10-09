<?php

declare(strict_types=1);

namespace Legacy;

use Psr\Http\Message\ResponseInterface as Response;

final class Json
{
    public static function respond(Response $response, array $data, int $status = 200): Response
    {
        $response->getBody()->write(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));

        return $response->withStatus($status)->withHeader('Content-Type', 'application/json');
    }

    public static function error(Response $response, int $status, string $code, string $message): Response
    {
        return self::respond($response, ['error' => ['code' => $code, 'message' => $message]], $status);
    }
}
