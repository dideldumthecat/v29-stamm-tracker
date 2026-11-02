<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261102172204 extends AbstractMigration
{
    /** Attributes code refers to, by their name when the key was introduced. */
    private const array KEYS = [
        'Stammmittendurchmesser groß' => 'mid_diameter_max',
        'Stammmittendurchmesser klein' => 'mid_diameter_min',
        'Länge' => 'length',
        'Gesägt' => 'sawn',
        'Gesägter Querschnitt' => 'sawn_cross_section',
        'Notiz' => 'notes',
        'Fotos' => 'photos',
    ];

    public function getDescription(): string
    {
        return 'Stable key per attribute';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE attributes ADD `key` VARCHAR(64) DEFAULT NULL');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_319B9E704E645A7E ON attributes (`key`)');
        // BINARY: the column collation would also match "Lange" for "Länge". Missing names update nothing.
        foreach (self::KEYS as $name => $key) {
            $this->addSql('UPDATE attributes SET `key` = ? WHERE BINARY name = ?', [$key, $name]);
        }
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX UNIQ_319B9E704E645A7E ON attributes');
        $this->addSql('ALTER TABLE attributes DROP `key`');
    }
}
