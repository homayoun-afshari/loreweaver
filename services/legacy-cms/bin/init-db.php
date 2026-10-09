<?php

// Run once before the server starts: creates the tables and seeds an empty database.
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Legacy\Config;
use Legacy\Database;

$config = Config::fromEnv();
Database::migrateAndSeed(Database::connect($config->dbPath));
echo "Database ready at {$config->dbPath}\n";
