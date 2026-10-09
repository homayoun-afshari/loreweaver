<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Legacy\App;
use Legacy\Config;

App::create(Config::fromEnv())->run();
