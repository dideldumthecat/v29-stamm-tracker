<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use App\Migration\DataMigration;
use App\Pile\PileEditor;
use Doctrine\DBAL\Schema\Schema;

/**
 * The first pile ("Polter 01") gets the master data of the handover record of the forestry office; they are real data on purpose.
 * It is the option "01 (0101/0145)" of the attribute "source". Its label becomes the one the pile page derives (PileEditor::label).
 * Without any option of "source" (a new database, where Version20261120180000 created the attribute empty) nothing happens; with other options but not this one, or a pile row already, it aborts.
 */
final class Version20261120190000 extends DataMigration
{
    private const string OLD_LABEL = '01 (0101/0145)';

    public function getDescription(): string
    {
        return 'Give the pile 01 its master data and its label';
    }

    public function up(Schema $schema): void
    {
        if (!$this->hasTables('attribute_options', 'attributes') || !$this->connection->fetchOne('SELECT 1 FROM attribute_options o JOIN attributes a ON a.id = o.attribute_id WHERE a.`key` = ? LIMIT 1', ['source'])) {
            return;
        }
        $id = $this->connection->fetchOne(
            'SELECT o.id FROM attribute_options o JOIN attributes a ON a.id = o.attribute_id WHERE a.`key` = ? AND BINARY o.label = ?',
            ['source', self::OLD_LABEL],
        );
        $this->abortIf(false === $id, \sprintf('There is no option "%s" of the attribute "source" to give master data to.', self::OLD_LABEL));
        $this->abortIf((bool) $this->connection->fetchOne('SELECT 1 FROM piles WHERE option_id = ?', [$id]), \sprintf('The option "%s" has master data already.', self::OLD_LABEL));

        $this->addSql(
            'INSERT INTO piles (option_id, number, location, latitude, longitude, stacked_volume) VALUES (?, ?, ?, ?, ?, ?)',
            [$id, '2601-010145', 'Krummes F', '51.413056', '13.060556', '51.52'],
        );
        $this->addSql('UPDATE attribute_options SET label = ? WHERE id = ?', [PileEditor::label('2601-010145', 'Krummes F'), $id]);
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }
}
