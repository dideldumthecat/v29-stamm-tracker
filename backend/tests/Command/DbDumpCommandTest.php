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
        $tester = new CommandTester((new Application(self::bootKernel()))->find('app:db:dump'));

        self::assertSame(Command::SUCCESS, $tester->execute([]));
        self::assertStringContainsString('CREATE TABLE `timber_items`', $tester->getDisplay());
        self::assertStringContainsString('CREATE TABLE `photos`', $tester->getDisplay());
    }
}
