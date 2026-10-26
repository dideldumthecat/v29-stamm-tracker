<?php

namespace App\Tests\Command;

use App\Command\ResetCommand;
use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Uid\Uuid;

class ResetCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private CommandTester $tester;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->tester = new CommandTester((new Application($kernel))->find('app:reset'));

        $user = new User('Kerstin', UserRole::User, User::hashToken('t'));
        $this->em->persist($user);
        $this->em->persist($attribute = new Attribute('Notiz', AttributeType::Text));
        $item = Uuid::v7();
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, EventType::Created, ['parent_id' => null], new \DateTimeImmutable(), $user));
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, EventType::AttributeRecorded, ['attribute_id' => $attribute->id->toRfc4122(), 'value' => 'x'], new \DateTimeImmutable(), $user));
        $this->em->flush();
        self::getContainer()->get(TimberItemProjector::class)->rebuildAll();
    }

    private function rows(string $table): int
    {
        return (int) $this->em->getConnection()->fetchOne("SELECT COUNT(*) FROM $table");
    }

    public function testDeletesEventsAndProjectionsAfterConfirmationAndKeepsUsersAndAttributes(): void
    {
        self::assertSame([1, 1], [$this->rows('timber_items'), $this->rows('timber_item_state')]);

        $this->tester->setInputs(['yes']);
        $this->tester->execute([]);

        self::assertSame(Command::SUCCESS, $this->tester->getStatusCode());
        self::assertMatchesRegularExpression('/timber_item_events\s+2/', $this->tester->getDisplay());
        self::assertSame([0, 0, 0], [$this->rows('timber_item_events'), $this->rows('timber_items'), $this->rows('timber_item_state')]);
        self::assertSame([1, 1], [$this->rows('attributes'), $this->rows('users')]);
    }

    public function testAttributesOptionAlsoRemovesAttributes(): void
    {
        $this->tester->setInputs(['yes']);
        $this->tester->execute(['--attributes' => true]);

        self::assertSame(Command::SUCCESS, $this->tester->getStatusCode());
        self::assertSame([0, 0, 1], [$this->rows('timber_item_events'), $this->rows('attributes'), $this->rows('users')]);
    }

    public function testProdIsAlwaysRefused(): void
    {
        $application = new Application(self::$kernel);
        $application->addCommand(new ResetCommand($this->em, 'prod'));
        $tester = new CommandTester($application->find('app:reset'));

        $tester->setInputs(['yes']);
        $tester->execute(['--attributes' => true, '--force' => true]);

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        self::assertStringContainsString('APP_ENV=prod', $tester->getDisplay());
        self::assertSame([2, 1, 1, 1], [$this->rows('timber_item_events'), $this->rows('timber_items'), $this->rows('timber_item_state'), $this->rows('attributes')]);
    }

    public function testDeclinedConfirmationDeletesNothing(): void
    {
        $this->tester->setInputs(['no']);
        $this->tester->execute(['--attributes' => true]);

        self::assertSame(Command::FAILURE, $this->tester->getStatusCode());
        self::assertSame([2, 1], [$this->rows('timber_item_events'), $this->rows('attributes')]);
    }

    public function testNonInteractiveNeedsForce(): void
    {
        $this->tester->execute(['--attributes' => true], ['interactive' => false]);
        self::assertSame(Command::FAILURE, $this->tester->getStatusCode());
        self::assertSame(2, $this->rows('timber_item_events'));

        $this->tester->execute(['--attributes' => true, '--force' => true], ['interactive' => false]);
        self::assertSame(Command::SUCCESS, $this->tester->getStatusCode());
        self::assertSame([0, 0, 1], [$this->rows('timber_item_events'), $this->rows('attributes'), $this->rows('users')]);
    }
}
