<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261111090153 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Kinds of timber item (stem, beam) an attribute is recorded on';
    }

    public function up(Schema $schema): void
    {
        // Nullable first: existing rows need a valid JSON value before NOT NULL applies.
        $this->addSql('ALTER TABLE attributes ADD applies_to JSON DEFAULT NULL');
        $this->addSql('UPDATE attributes SET applies_to = ?', ['["stem","beam"]']);
        $this->addSql('ALTER TABLE attributes MODIFY applies_to JSON NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE attributes DROP applies_to');
    }
}
