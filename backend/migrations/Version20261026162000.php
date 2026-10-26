<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20261026162000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Rejected sync events';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE rejected_syncs (id BINARY(16) NOT NULL, reason VARCHAR(64) NOT NULL, events JSON NOT NULL, received_at DATETIME(6) NOT NULL, user_id BINARY(16) NOT NULL, INDEX IDX_CAE50311A76ED395 (user_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('ALTER TABLE rejected_syncs ADD CONSTRAINT FK_CAE50311A76ED395 FOREIGN KEY (user_id) REFERENCES users (id)');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('ALTER TABLE rejected_syncs DROP FOREIGN KEY FK_CAE50311A76ED395');
        $this->addSql('DROP TABLE rejected_syncs');
    }
}
