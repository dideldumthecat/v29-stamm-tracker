<?php

namespace App\Tests\Command;

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

class ItemVoidCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private TimberItemProjector $projector;
    private CommandTester $tester;
    private User $admin;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->projector = self::getContainer()->get(TimberItemProjector::class);
        $this->tester = new CommandTester((new Application($kernel))->find('app:item:void'));

        $this->em->persist($this->admin = new User('Alexander', UserRole::Superadmin, User::hashToken('a')));
        $this->em->flush();
    }

    private function item(string $tag, ?Uuid $parent = null): Uuid
    {
        $id = Uuid::v7();
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $id, EventType::Created, ['parent_id' => $parent?->toRfc4122()], new \DateTimeImmutable(), $this->admin));
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $id, EventType::TagAssigned, ['tag_number' => $tag], new \DateTimeImmutable(), $this->admin));
        $this->em->flush();
        $this->projector->project($id);

        return $id;
    }

    private function voids(): int
    {
        return (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events WHERE type = ?', [EventType::Voided->value]);
    }

    public function testDryRunShowsTheItemAndWritesNothing(): void
    {
        $this->item('1999');

        self::assertSame(Command::SUCCESS, $this->tester->execute(['tag' => '01999', '--dry-run' => true]));

        self::assertStringContainsString('1999', $this->tester->getDisplay());
        self::assertStringContainsString('Would void 1999', $this->tester->getDisplay());
        self::assertSame(0, $this->voids());
    }

    public function testVoidsWithoutPromptAndFreesTheTag(): void
    {
        $this->item('5');

        self::assertSame(Command::SUCCESS, $this->tester->execute(['tag' => '5'], ['interactive' => false]));

        self::assertSame(1, $this->voids());
        self::assertSame(
            'Alexander',
            $this->em->getConnection()->fetchOne('SELECT u.name FROM timber_item_events e JOIN users u ON u.id = e.user_id WHERE e.type = ?', ['voided']),
        );
        $this->item('5');
        self::assertSame(1, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_items WHERE tag_number = ? AND voided_at IS NULL', ['5']));
    }

    public function testWithoutASuperadminNothingIsWrittenAndWithOneItIsRecordedUnderThem(): void
    {
        $this->item('1999');
        $this->admin->role = UserRole::Admin;
        $this->em->flush();

        self::assertSame(Command::FAILURE, $this->tester->execute(['tag' => '1999']));
        self::assertStringContainsString('app:user:role', $this->tester->getDisplay());
        self::assertSame(0, $this->voids());

        $this->admin->role = UserRole::Superadmin;
        $this->em->flush();
        self::assertSame(Command::SUCCESS, $this->tester->execute(['tag' => '1999']));
        self::assertSame(1, $this->voids());
        self::assertSame($this->admin->id->toBinary(), $this->em->getConnection()->fetchOne('SELECT user_id FROM timber_item_events WHERE type = ?', [EventType::Voided->value]));
    }

    public function testBeamsMustBeVoidedFirst(): void
    {
        $stem = $this->item('7');
        $this->item('7-A', $stem);

        self::assertSame(Command::FAILURE, $this->tester->execute(['tag' => '7']));
        self::assertStringContainsString('void its beams first: 7-A', $this->tester->getDisplay());
        self::assertSame(Command::SUCCESS, $this->tester->execute(['tag' => '7-A']));
        self::assertSame(Command::SUCCESS, $this->tester->execute(['tag' => '7']));
        self::assertSame(2, $this->voids());
    }

    public function testUnknownOrMalformedTagFails(): void
    {
        self::assertSame(Command::FAILURE, $this->tester->execute(['tag' => '42']));
        self::assertStringContainsString('No timber item with tag 42', $this->tester->getDisplay());
        self::assertSame(Command::FAILURE, $this->tester->execute(['tag' => 'abc']));
        self::assertStringContainsString('is not a tag', $this->tester->getDisplay());
    }
}
