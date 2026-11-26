<?php

namespace App\Migration;

use Doctrine\Migrations\AbstractMigration;

/**
 * Base class for migrations that read data in up(). A dry run executes no SQL, so on an empty database the tables
 * the earlier migrations create do not exist yet; such a migration asks hasTables() and finds nothing to read then.
 * A real run always has them: the migrations run in order and each one is executed before the next.
 */
abstract class DataMigration extends AbstractMigration
{
    protected function hasTables(string ...$tables): bool
    {
        return $this->connection->createSchemaManager()->tablesExist($tables);
    }
}
