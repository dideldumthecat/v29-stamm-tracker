<?php

namespace App\Tests\Command;

use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

class DbDumpCommandTest extends KernelTestCase
{
    public function testDumpsTheSchema(): void
    {
        // The MySQL 8 client (GitHub runners) cannot dump MariaDB 11.8; the check runs locally in DDEV only.
        if (!str_contains((string) shell_exec('mysqldump --version 2>&1'), 'MariaDB')) {
            self::markTestSkipped('mysqldump is not the MariaDB client.');
        }

        $tester = new CommandTester((new Application(self::bootKernel()))->find('app:db:dump'));

        self::assertSame(Command::SUCCESS, $tester->execute([]), $tester->getDisplay());
        self::assertStringContainsString('CREATE TABLE `timber_items`', $tester->getDisplay());
        self::assertStringContainsString('CREATE TABLE `photos`', $tester->getDisplay());
    }
}
