<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20261024104408 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Projections timber_items and timber_item_state';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE timber_item_state (timber_item_id BINARY(16) NOT NULL, attribute_id BINARY(16) NOT NULL, value_records JSON NOT NULL, PRIMARY KEY (timber_item_id, attribute_id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('CREATE TABLE timber_items (id BINARY(16) NOT NULL, parent_id BINARY(16) DEFAULT NULL, tag_number VARCHAR(32) DEFAULT NULL, has_children TINYINT NOT NULL, created_at DATETIME(6) NOT NULL, created_by BINARY(16) NOT NULL, PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('DROP TABLE timber_item_state');
        $this->addSql('DROP TABLE timber_items');
    }
}
