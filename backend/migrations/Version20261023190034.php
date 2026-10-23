<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20261023190034 extends AbstractMigration
{
    public function getDescription(): string
    {
        return '';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE attribute_options (id BINARY(16) NOT NULL, label VARCHAR(255) NOT NULL, sort_order INT NOT NULL, active TINYINT NOT NULL, attribute_id BINARY(16) NOT NULL, INDEX IDX_5BA9A343B6E62EFA (attribute_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('CREATE TABLE attributes (id BINARY(16) NOT NULL, name VARCHAR(255) NOT NULL, type VARCHAR(16) NOT NULL, description LONGTEXT NOT NULL, unit VARCHAR(32) DEFAULT NULL, is_series TINYINT NOT NULL, is_inheritable TINYINT NOT NULL, sort_order INT NOT NULL, active TINYINT NOT NULL, PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('CREATE TABLE timber_item_events (received_at DATETIME(6) NOT NULL, id BINARY(16) NOT NULL, timber_item_id BINARY(16) NOT NULL, type VARCHAR(32) NOT NULL, data JSON NOT NULL, recorded_at DATETIME(6) NOT NULL, reference_id BINARY(16) DEFAULT NULL, user_id BINARY(16) NOT NULL, INDEX idx_events_item_received (timber_item_id, received_at), INDEX idx_events_reference (reference_id), INDEX IDX_4FFB1AE3A76ED395 (user_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('CREATE TABLE users (id BINARY(16) NOT NULL, name VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, token_hash CHAR(64) NOT NULL, created_at DATETIME NOT NULL, revoked_at DATETIME DEFAULT NULL, UNIQUE INDEX uniq_users_token_hash (token_hash), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('ALTER TABLE attribute_options ADD CONSTRAINT FK_5BA9A343B6E62EFA FOREIGN KEY (attribute_id) REFERENCES attributes (id)');
        $this->addSql('ALTER TABLE timber_item_events ADD CONSTRAINT FK_4FFB1AE3A76ED395 FOREIGN KEY (user_id) REFERENCES users (id)');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('ALTER TABLE attribute_options DROP FOREIGN KEY FK_5BA9A343B6E62EFA');
        $this->addSql('ALTER TABLE timber_item_events DROP FOREIGN KEY FK_4FFB1AE3A76ED395');
        $this->addSql('DROP TABLE attribute_options');
        $this->addSql('DROP TABLE attributes');
        $this->addSql('DROP TABLE timber_item_events');
        $this->addSql('DROP TABLE users');
    }
}
