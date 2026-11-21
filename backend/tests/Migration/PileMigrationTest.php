<?php

namespace App\Tests\Migration;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;
use Doctrine\Migrations\Exception\AbortMigration;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Uid\Uuid;

/** Version20261120180000: the key "source" and the removal of the options no event mentions. */
class PileMigrationTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Attribute $source;
    private User $user;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->em->persist($this->user = new User('Ada', UserRole::Superadmin, User::hashToken(User::normalizeToken('Ada-test-token'))));
        $this->em->persist($this->source = new Attribute('Polternummer', AttributeType::Choice));
    }

    private function option(string $label, int $order): AttributeOption
    {
        $this->em->persist($option = new AttributeOption($this->source, $label, $order));

        return $option;
    }

    private function record(AttributeOption $option, bool $voided = false): void
    {
        $item = Uuid::v7();
        $at = new \DateTimeImmutable();
        $this->em->persist($created = new TimberItemEvent(Uuid::v7(), $item, EventType::Created, ['parent_id' => null], $at, $this->user));
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, EventType::AttributeRecorded, ['attribute_id' => $this->source->id->toRfc4122(), 'value' => $option->id->toRfc4122()], $at, $this->user));
        if ($voided) {
            $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, EventType::Voided, [], $at, $this->user, $created->id));
        }
    }

    /** Plans the migration and runs its SQL like doctrine:migrations:migrate, except the table (DDL would end the transaction of the test). */
    private function migrate(): void
    {
        $this->em->flush();
        require_once __DIR__.'/../../migrations/Version20261120180000.php';
        /** @var class-string<AbstractMigration> $class */
        $class = implode('\\', ['DoctrineMigrations', 'Version20261120180000']);
        $migration = new $class($this->em->getConnection(), new NullLogger());
        $migration->up(new Schema());
        foreach ($migration->getSql() as $query) {
            if (!str_contains($query->getStatement(), 'piles')) {
                $this->em->getConnection()->executeStatement($query->getStatement(), $query->getParameters(), $query->getTypes());
            }
        }
        $this->em->clear();
    }

    /** @return list<string> */
    private function labels(): array
    {
        return array_map(
            static fn (AttributeOption $o) => $o->label,
            $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $this->source->id], ['sortOrder' => 'ASC']),
        );
    }

    public function testGivesTheKeyAndDeletesTheOptionsNoEventMentions(): void
    {
        $this->record($this->option('01', 10));
        $this->option('02', 20);
        $this->record($this->option('03', 30), voided: true);
        $this->option('04', 40);
        $other = new Attribute('Holzart', AttributeType::Choice);
        $this->em->persist($other);
        $this->em->persist(new AttributeOption($other, 'Eiche', 10));

        $this->migrate();

        self::assertSame('source', $this->em->find(Attribute::class, $this->source->id)->key);
        self::assertSame(['01', '03'], $this->labels());
        self::assertCount(1, $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $other->id]));
    }

    public function testRunsOnAnAttributeThatHasTheKeyAlready(): void
    {
        $this->em->remove($this->source);
        $this->em->flush();
        $this->em->persist($this->source = new Attribute('Polternummer', AttributeType::Choice, key: 'source'));
        $this->option('02', 20);

        $this->migrate();

        self::assertSame([], $this->labels());
    }

    public function testCreatesTheAttributeOnAnEmptyDatabase(): void
    {
        $this->em->remove($this->source);

        $this->migrate();

        $attributes = $this->em->getRepository(Attribute::class)->findAll();
        self::assertCount(1, $attributes);
        self::assertSame('source', $attributes[0]->key);
        self::assertSame('Polternummer', $attributes[0]->name);
        self::assertSame(AttributeType::Choice, $attributes[0]->type);
        self::assertSame(['stem'], $attributes[0]->appliesTo);
        self::assertTrue($attributes[0]->isInheritable);
        self::assertSame([], $this->em->getRepository(AttributeOption::class)->findAll());
    }

    public function testCreatesTheAttributeNextToOthers(): void
    {
        $this->source->name = 'Holzart';

        $this->migrate();

        $keys = array_map(static fn (Attribute $a) => $a->key, $this->em->getRepository(Attribute::class)->findAll());
        self::assertEqualsCanonicalizing([null, 'source'], $keys);
    }

    public function testAbortsWhenTheProjectionMentionsAnOptionNoEventDoes(): void
    {
        $option = $this->option('02', 20);
        $this->em->flush();
        $this->em->getConnection()->executeStatement(
            'INSERT INTO timber_item_state (timber_item_id, attribute_id, value_records) VALUES (?, ?, ?)',
            [Uuid::v7()->toBinary(), $this->source->id->toBinary(), json_encode([['value' => $option->id->toRfc4122()]])],
        );

        $this->expectException(AbortMigration::class);
        $this->expectExceptionMessage('rebuild the projections first');
        $this->migrate();
    }
}
