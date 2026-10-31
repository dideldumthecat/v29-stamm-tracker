<?php

namespace App\Command;

use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Process\Process;

/**
 * SQL dump of the app database on stdout and nothing else, so it can be piped (`ssh … app:db:dump | gzip`).
 * Used by `ddev sync` and for manual backups; photos are files and not part of it.
 */
#[AsCommand(name: 'app:db:dump', description: 'Write an SQL dump of the database to stdout')]
class DbDumpCommand
{
    public function __construct(private readonly Connection $connection)
    {
    }

    public function __invoke(OutputInterface $output): int
    {
        $params = $this->connection->getParams();
        $errors = $output instanceof ConsoleOutputInterface ? $output->getErrorOutput() : $output;

        // The password goes into a file readable only by us: arguments and environment are visible to other processes.
        $file = tempnam(sys_get_temp_dir(), 'dbdump');
        try {
            chmod($file, 0600);
            file_put_contents($file, \sprintf("[client]\nuser=\"%s\"\npassword=\"%s\"\nhost=\"%s\"\nport=%d\n",
                self::escape($params['user'] ?? ''), self::escape($params['password'] ?? ''),
                self::escape($params['host'] ?? 'localhost'), $params['port'] ?? 3306));

            // --defaults-file, not --defaults-extra-file: the latter is read before ~/.my.cnf, which would override our credentials
            // (DDEV ships one with root). It must be the first argument.
            $process = new Process([
                'mysqldump', '--defaults-file='.$file,
                '--single-transaction', '--quick', '--no-tablespaces', '--skip-lock-tables', '--default-character-set=utf8mb4',
                $params['dbname'],
            ]);
            $process->setTimeout(600);
            $process->run(static function (string $type, string $buffer) use ($output, $errors): void {
                (Process::OUT === $type ? $output : $errors)->write($buffer, false, OutputInterface::OUTPUT_RAW);
            });
        } finally {
            @unlink($file);
        }

        return $process->isSuccessful() ? Command::SUCCESS : Command::FAILURE;
    }

    private static function escape(string $value): string
    {
        return addcslashes($value, '\\"');
    }
}
