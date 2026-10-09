<?php

declare(strict_types=1);

namespace Legacy;

use PDO;

final class CharacterRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** Full state in the legacy shape: snake_case, nested status, numeric location code. */
    public function findState(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM characters WHERE char_id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        return [
            'char_id' => (int) $row['char_id'],
            'char_name' => $row['char_name'],
            'world_id' => $row['world_id'],
            'loc_code' => (int) $row['loc_code'],
            'inv_str' => $row['inv_str'],
            'status' => [
                'mana_pts' => $row['mana_pts'],
                'hp_pts' => $row['hp_pts'],
                'cond_flag' => $row['cond_flag'],
            ],
            'last_upd' => $row['last_upd'],
        ];
    }

    /** @return array{items: list<array<string, mixed>>, total: int} */
    public function listByWorld(string $worldId, int $page, int $perPage): array
    {
        $count = $this->pdo->prepare('SELECT COUNT(*) FROM characters WHERE world_id = ?');
        $count->execute([$worldId]);

        $stmt = $this->pdo->prepare(
            'SELECT char_id, char_name, world_id FROM characters
             WHERE world_id = ? ORDER BY char_id LIMIT ? OFFSET ?'
        );
        $stmt->bindValue(1, $worldId);
        $stmt->bindValue(2, $perPage, PDO::PARAM_INT);
        $stmt->bindValue(3, ($page - 1) * $perPage, PDO::PARAM_INT);
        $stmt->execute();

        $items = array_map(
            static fn (array $r): array => [
                'char_id' => (int) $r['char_id'],
                'char_name' => $r['char_name'],
                'world_id' => $r['world_id'],
            ],
            $stmt->fetchAll()
        );

        return ['items' => $items, 'total' => (int) $count->fetchColumn()];
    }
}
