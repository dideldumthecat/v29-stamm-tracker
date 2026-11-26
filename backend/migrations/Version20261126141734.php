<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;
use Symfony\Component\Uid\Uuid;

/**
 * User groups decide which attributes the app shows. Two groups to start with: "V29" sees all attributes, future ones included;
 * "Sägewerk" sees every attribute that exists now except "Entrindet" (none if it does not exist). Users with the role "user" go to
 * "Sägewerk", all others to "V29". Plain SQL on purpose: the tables only exist once the statements before have run.
 */
final class Version20261126141734 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create user groups and give every user one';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE user_groups (id BINARY(16) NOT NULL, name VARCHAR(255) NOT NULL, sees_all_attributes TINYINT NOT NULL, UNIQUE INDEX uniq_user_groups_name (name), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('CREATE TABLE user_group_attributes (group_id BINARY(16) NOT NULL, attribute_id BINARY(16) NOT NULL, INDEX IDX_9B43BD1FFE54D947 (group_id), INDEX IDX_9B43BD1FB6E62EFA (attribute_id), PRIMARY KEY (group_id, attribute_id)) DEFAULT CHARACTER SET utf8mb4');
        $this->addSql('ALTER TABLE user_group_attributes ADD CONSTRAINT FK_9B43BD1FFE54D947 FOREIGN KEY (group_id) REFERENCES user_groups (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE user_group_attributes ADD CONSTRAINT FK_9B43BD1FB6E62EFA FOREIGN KEY (attribute_id) REFERENCES attributes (id) ON DELETE CASCADE');

        $v29 = Uuid::v7()->toBinary();
        $sawmill = Uuid::v7()->toBinary();
        $this->addSql('INSERT INTO user_groups (id, name, sees_all_attributes) VALUES (?, ?, 1), (?, ?, 0)', [$v29, 'V29', $sawmill, 'Sägewerk']);
        $this->addSql('INSERT INTO user_group_attributes (group_id, attribute_id) SELECT ?, id FROM attributes WHERE BINARY name <> ?', [$sawmill, 'Entrindet']);

        $this->addSql('ALTER TABLE users ADD group_id BINARY(16) DEFAULT NULL');
        $this->addSql('UPDATE users SET group_id = IF(role = ?, ?, ?)', ['user', $sawmill, $v29]);
        $this->addSql('ALTER TABLE users MODIFY group_id BINARY(16) NOT NULL');
        $this->addSql('ALTER TABLE users ADD CONSTRAINT FK_1483A5E9FE54D947 FOREIGN KEY (group_id) REFERENCES user_groups (id)');
        $this->addSql('CREATE INDEX IDX_1483A5E9FE54D947 ON users (group_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users DROP FOREIGN KEY FK_1483A5E9FE54D947');
        $this->addSql('DROP INDEX IDX_1483A5E9FE54D947 ON users');
        $this->addSql('ALTER TABLE users DROP group_id');
        $this->addSql('DROP TABLE user_group_attributes');
        $this->addSql('DROP TABLE user_groups');
    }
}
