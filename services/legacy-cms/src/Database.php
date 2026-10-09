<?php

declare(strict_types=1);

namespace Legacy;

use PDO;

final class Database
{
    public static function connect(string $path): PDO
    {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        // Several server workers share the file: wait for locks instead of failing.
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA journal_mode = WAL');

        return $pdo;
    }

    /** Creates the tables and, on a fresh database only, inserts the seed data. */
    public static function migrateAndSeed(PDO $pdo): void
    {
        // Deliberately "legacy" column names and storage formats.
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS characters (
                char_id   INTEGER PRIMARY KEY,
                char_name TEXT NOT NULL,
                world_id  TEXT NOT NULL,
                loc_code  INTEGER NOT NULL,
                mana_pts  TEXT NOT NULL,
                hp_pts    TEXT NOT NULL,
                cond_flag TEXT NOT NULL,
                inv_str   TEXT NOT NULL,
                last_upd  TEXT NOT NULL
            )'
        );
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_characters_world ON characters (world_id)');
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS rate_limit (
                key_id TEXT NOT NULL,
                window INTEGER NOT NULL,
                hits   INTEGER NOT NULL,
                PRIMARY KEY (key_id, window)
            )'
        );

        if ((int) $pdo->query('SELECT COUNT(*) FROM characters')->fetchColumn() > 0) {
            return;
        }

        $insert = $pdo->prepare(
            'INSERT INTO characters (char_id, char_name, world_id, loc_code, mana_pts, hp_pts, cond_flag, inv_str, last_upd)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        // Two worlds, so tenant isolation can be tested later. Mana and HP are zero-padded text,
        // inventory is one comma-separated string, dates use a DD-MON-YY format.
        $rows = [
            [1, 'Aria Voss', 'world_aethel', 17, '020', '085', 'OK', 'flint,broken sword,health potion', '09-OCT-26 14:32'],
            [2, 'Brannoc Hale', 'world_aethel', 4, '000', '100', 'OK', 'war hammer,iron ration', '08-OCT-26 09:05'],
            [3, 'Sera Quill', 'world_aethel', 9, '075', '060', 'WND', 'spellbook,silver key,ink vial', '07-OCT-26 21:48'],
            [4, 'Kael Draven', 'world_nox', 22, '040', '090', 'OK', 'lantern,cracked mask', '09-OCT-26 11:15'],
            [5, 'Mira Sol', 'world_nox', 3, '100', '045', 'WND', 'star chart', '06-OCT-26 17:20'],
        ];
        foreach ($rows as $row) {
            $insert->execute($row);
        }
    }
}
