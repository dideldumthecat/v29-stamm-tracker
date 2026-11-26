<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use App\Entity\AttributeType;
use App\Migration\AttributeMigration;
use Doctrine\DBAL\Schema\Schema;
use Symfony\Component\Uid\Uuid;

/**
 * A pile ("Polter") gets master data from the handover record of the forestry office: table piles, one row per option of the attribute "Polternummer",
 * which becomes the system attribute "source". The piles are maintained in the administration from now on.
 *
 * The only place where options are deleted ("options are never deleted" everywhere else): the production data holds placeholder options (02 to 10)
 * that no stem refers to and that would show up as piles without data. An option stays as soon as any event mentions its id, voided events included;
 * it aborts if the projection mentions an option that no event does (the projection is built from the events, so the two must agree).
 * A database without "Polternummer" (CI, a new test database) gets the attribute without options, like the one V29 created by hand: stem only, inherited by beams.
 */
final class Version20261120180000 extends AttributeMigration
{
    public function getDescription(): string
    {
        return 'Create piles and give the attribute "Polternummer" the key "source"';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE piles (number VARCHAR(32) NOT NULL, location VARCHAR(200) DEFAULT NULL, latitude NUMERIC(9, 6) DEFAULT NULL, longitude NUMERIC(9, 6) DEFAULT NULL, stacked_volume NUMERIC(8, 2) DEFAULT NULL, option_id BINARY(16) NOT NULL, UNIQUE INDEX UNIQ_E995227B96901F54 (number), PRIMARY KEY (option_id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('ALTER TABLE piles ADD CONSTRAINT FK_E995227BA7C41D6F FOREIGN KEY (option_id) REFERENCES attribute_options (id)');

        $attributesExist = $this->hasTables('attributes');
        $attributeId = $attributesExist ? $this->connection->fetchOne('SELECT id FROM attributes WHERE `key` = ? OR name = ?', ['source', 'Polternummer']) : false;
        if (false === $attributeId) {
            // Not addAttribute(): it insists on options for a choice, and the piles are what fills this one
            $this->addSql(
                'INSERT INTO attributes (id, name, type, description, unit, is_series, is_inheritable, sort_order, active, `key`, applies_to, hidden_when) VALUES (?, ?, ?, ?, NULL, 0, 1, ?, 1, ?, ?, ?)',
                [Uuid::v7()->toBinary(), 'Polternummer', AttributeType::Choice->value, '', 10 + (int) ($attributesExist ? $this->connection->fetchOne('SELECT COALESCE(MAX(sort_order), 0) FROM attributes') : 0), 'source', '["stem"]', '[]'],
            );

            return;
        }
        if (!$this->hasAttribute('source')) {
            $this->assignKey('Polternummer', 'source');
        }

        $unused = [];
        foreach ($this->connection->fetchAllAssociative('SELECT id, label FROM attribute_options WHERE attribute_id = ?', [$attributeId]) as $option) {
            $id = $this->uuid($option['id']);
            if ($this->mentions('timber_item_events', 'data', $id)) {
                continue;
            }
            $this->abortIf($this->mentions('timber_item_state', 'value_records', $id), \sprintf('The option "%s" is in timber_item_state but in no event: rebuild the projections first.', $option['label']));
            $unused[] = $option['id'];
        }
        foreach ($unused as $id) {
            $this->addSql('DELETE FROM attribute_options WHERE id = ?', [$id]);
        }
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }

    private function uuid(string $binary): string
    {
        return Uuid::fromBinary($binary)->toRfc4122();
    }

    private function mentions(string $table, string $column, string $id): bool
    {
        return (bool) $this->connection->fetchOne(\sprintf('SELECT 1 FROM %s WHERE LOCATE(?, %s) > 0 LIMIT 1', $table, $column), [$id]);
    }
}
