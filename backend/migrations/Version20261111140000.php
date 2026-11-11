<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261111140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Keys of yes/no attributes that hide an attribute in the app while one of them is "ja"';
    }

    public function up(Schema $schema): void
    {
        // Nullable first: existing rows need a valid JSON value before NOT NULL applies.
        $this->addSql('ALTER TABLE attributes ADD hidden_when JSON DEFAULT NULL');
        $this->addSql('UPDATE attributes SET hidden_when = ?', ['[]']);
        $this->addSql('ALTER TABLE attributes MODIFY hidden_when JSON NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE attributes DROP hidden_when');
    }
}
