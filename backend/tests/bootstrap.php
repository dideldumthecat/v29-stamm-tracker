<?php

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;

require dirname(__DIR__).'/vendor/autoload.php';

(new Dotenv())->bootEnv(dirname(__DIR__).'/.env');

if ($_SERVER['APP_DEBUG']) {
    umask(0000);
}

// The migrations create the system attributes in the test database, but every test builds its own attributes
// (with the same keys), so start each run without them. Tests roll back, they never see the committed ones again.
// The kernel's own connection knows the database name (`dbname_suffix` of `doctrine.yaml` included).
$kernel = new Kernel('test', (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$connection = $kernel->getContainer()->get('doctrine')->getConnection();
$connection->executeStatement('DELETE FROM piles');
$connection->executeStatement('DELETE FROM attribute_options');
$connection->executeStatement('DELETE FROM attributes');
$kernel->shutdown();
