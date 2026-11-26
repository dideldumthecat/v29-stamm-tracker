<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use App\Migration\DataMigration;
use Doctrine\DBAL\Schema\Schema;
use Symfony\Component\Uid\Uuid;

/**
 * hidden_when used to list the keys of yes/no attributes; it lists their ids now, so an attribute without a key can hide others too.
 * Entries that are the id of an attribute stay (the migration may run on data that is converted already); every other entry must be
 * the key of a yes/no attribute, otherwise the migration aborts and changes nothing.
 */
final class Version20261119140000 extends DataMigration
{
    public function getDescription(): string
    {
        return 'Replace the keys in attributes.hidden_when by attribute ids';
    }

    public function up(Schema $schema): void
    {
        if (!$this->hasTables('attributes')) {
            return;
        }
        $idOf = [];
        $isYesNo = [];
        foreach ($this->connection->fetchAllAssociative('SELECT id, `key`, type FROM attributes') as $row) {
            $id = Uuid::fromBinary($row['id'])->toRfc4122();
            $isYesNo[$id] = 'boolean' === $row['type'];
            if (null !== $row['key']) {
                $idOf[$row['key']] = $id;
            }
        }

        foreach ($this->connection->fetchAllAssociative('SELECT id, name, hidden_when FROM attributes') as $row) {
            $entries = json_decode($row['hidden_when'], true, flags: \JSON_THROW_ON_ERROR);
            $ids = [];
            foreach ($entries as $entry) {
                $id = isset($isYesNo[$entry]) ? $entry : ($idOf[$entry] ?? null);
                $this->abortIf(null === $id, \sprintf('"%s" is hidden by "%s", but no attribute has that key or id.', $row['name'], $entry));
                $this->abortIf(!$isYesNo[$id], \sprintf('"%s" is hidden by "%s", which is not a yes/no attribute.', $row['name'], $entry));
                $ids[] = $id;
            }
            $ids = array_values(array_unique($ids));
            sort($ids);
            if ($ids !== $entries) {
                $this->addSql('UPDATE attributes SET hidden_when = ? WHERE id = ?', [json_encode($ids), $row['id']]);
            }
        }
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }
}
