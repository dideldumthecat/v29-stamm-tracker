<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20261029122940 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Photos';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE photos (id BINARY(16) NOT NULL, timber_item_id BINARY(16) NOT NULL, size INT UNSIGNED NOT NULL, sha256 CHAR(64) NOT NULL, taken_at DATETIME(6) NOT NULL, uploaded_at DATETIME(6) NOT NULL, user_id BINARY(16) NOT NULL, INDEX idx_photos_item (timber_item_id), INDEX idx_photos_sha256 (sha256), INDEX IDX_876E0D9A76ED395 (user_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('ALTER TABLE photos ADD CONSTRAINT FK_876E0D9A76ED395 FOREIGN KEY (user_id) REFERENCES users (id)');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('ALTER TABLE photos DROP FOREIGN KEY FK_876E0D9A76ED395');
        $this->addSql('DROP TABLE photos');
    }
}
