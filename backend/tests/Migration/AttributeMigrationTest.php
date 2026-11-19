<?php

namespace App\Tests\Migration;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Migration\AttributeMigration;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;
use Doctrine\Migrations\Exception\AbortMigration;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/** The helper for system-attribute migrations and the migration that creates them on an empty database. */
class AttributeMigrationTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Connection $connection;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->connection = $this->em->getConnection();
    }

    /** Runs what the migration plans against the database, like doctrine:migrations:migrate. */
    private function execute(AbstractMigration $migration): int
    {
        $migration->up(new Schema());
        foreach ($migration->getSql() as $query) {
            $this->connection->executeStatement($query->getStatement(), $query->getParameters(), $query->getTypes());
        }

        return \count($migration->getSql());
    }

    /** @param callable(object): void $up */
    private function migration(callable $up): AttributeMigration
    {
        return new class($this->connection, new NullLogger(), $up) extends AttributeMigration {
            /** @param callable(object): void $up */
            public function __construct(Connection $connection, NullLogger $logger, private $up)
            {
                parent::__construct($connection, $logger);
            }

            public function up(Schema $schema): void
            {
                ($this->up)($this);
            }

            /**
             * @param list<string> $options
             * @param list<string> $hiddenWhen
             */
            public function add(string $key, string $name, AttributeType $type = AttributeType::Text, array $options = [], array $hiddenWhen = []): void
            {
                $this->addAttribute($key, $name, $type, ['stem'], false, options: $options, hiddenWhen: $hiddenWhen);
            }

            public function key(string $name, string $key): void
            {
                $this->assignKey($name, $key);
            }

            public function option(string $key, string $label): void
            {
                $this->addOption($key, $label);
            }

            public function rename(string $key, string $from, string $to): void
            {
                $this->renameOption($key, $from, $to);
            }
        };
    }

    public function testTheBaseMigrationCreatesEverySystemAttributeOnceAndThenChangesNothing(): void
    {
        require_once __DIR__.'/../../migrations/Version20261119100000.php';
        // Not autoloaded (see config/packages/doctrine_migrations.yaml), so only its name is known
        /** @var class-string<AbstractMigration> $class */
        $class = implode('\\', ['DoctrineMigrations', 'Version20261119100000']);
        $baseMigration = fn (): AbstractMigration => new $class($this->connection, new NullLogger());

        $created = $this->execute($baseMigration());
        self::assertSame(15, $created);
        $this->em->clear();
        $attributes = $this->em->getRepository(Attribute::class)->findBy([], ['sortOrder' => 'ASC']);
        self::assertSame(
            ['mid_diameter_max', 'mid_diameter_min', 'length', 'unsawable', 'sawn', 'sawn_cross_section', 'notes', 'photos'],
            array_map(static fn (Attribute $a) => $a->key, $attributes),
        );
        $byKey = array_column(array_map(static fn (Attribute $a) => ['key' => $a->key, 'a' => $a], $attributes), 'a', 'key');
        self::assertSame(AttributeType::Number, $byKey['mid_diameter_max']->type);
        self::assertSame('cm', $byKey['mid_diameter_max']->unit);
        self::assertSame(['stem'], $byKey['mid_diameter_max']->appliesTo);
        self::assertFalse($byKey['mid_diameter_max']->isInheritable);
        self::assertTrue($byKey['length']->isInheritable);
        self::assertSame([$byKey['sawn']->id->toRfc4122()], $byKey['unsawable']->hiddenWhen);
        self::assertSame([$byKey['unsawable']->id->toRfc4122()], $byKey['sawn']->hiddenWhen);
        self::assertTrue($byKey['photos']->isSeries);
        self::assertSame(['4,10 m', '3,60 m', '3,20 m'], array_map(
            static fn (AttributeOption $o) => $o->label,
            $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $byKey['length']], ['sortOrder' => 'ASC']),
        ));

        self::assertSame(0, $this->execute($baseMigration()));
    }

    public function testNewAttributesGoToTheEndOfTheOrder(): void
    {
        $this->execute($this->migration(static function ($m): void {
            $m->add('first', 'Eins');
            $m->add('pick', 'Wahl', AttributeType::Choice, ['A', 'B']);
        }));
        $this->em->clear();
        $order = array_map(static fn (Attribute $a) => $a->key, $this->em->getRepository(Attribute::class)->findBy([], ['sortOrder' => 'ASC']));
        self::assertSame(['first', 'pick'], $order);
    }

    public function testKeyCanBeAssignedToAnExistingAttributeByName(): void
    {
        $this->em->persist(new Attribute('Entrindet', AttributeType::Boolean));
        $this->em->flush();
        $this->execute($this->migration(static fn ($m) => $m->key('Entrindet', 'debarked')));
        $this->em->clear();
        self::assertNotNull($this->em->getRepository(Attribute::class)->findOneBy(['key' => 'debarked']));
    }

    public function testOptionsAreAppendedAndRenamed(): void
    {
        $this->execute($this->migration(static function ($m): void {
            $m->add('pick', 'Wahl', AttributeType::Choice, ['A', 'B']);
            $m->option('pick', 'C');
            $m->rename('pick', 'B', 'Bee');
        }));
        $this->em->clear();
        $attribute = $this->em->getRepository(Attribute::class)->findOneBy(['key' => 'pick']);
        self::assertSame(['A', 'Bee', 'C'], array_map(
            static fn (AttributeOption $o) => $o->label,
            $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $attribute], ['sortOrder' => 'ASC']),
        ));
    }

    /** @return iterable<string, array{callable(object): void, string}> */
    public static function mistakes(): iterable
    {
        yield 'unknown name' => [static fn ($m) => $m->key('Gibt es nicht', 'x'), 'found 0 attributes named "Gibt es nicht"'];
        yield 'ambiguous name' => [static function ($m): void {
            $m->add('a', 'Doppelt');
            $m->add('b', 'Doppelt');
            $m->key('Doppelt', 'c');
        }, 'found 2 attributes named "Doppelt"'];
        yield 'key exists on add' => [static function ($m): void {
            $m->add('a', 'Eins');
            $m->add('a', 'Zwei');
        }, 'exists already'];
        yield 'key exists on assign' => [static function ($m): void {
            $m->add('a', 'Eins');
            $m->add('b', 'Zwei');
            $m->key('Zwei', 'a');
        }, 'exists already'];
        yield 'attribute has a key already' => [static function ($m): void {
            $m->add('a', 'Eins');
            $m->key('Eins', 'b');
        }, 'a key never changes'];
        yield 'invalid key' => [static fn ($m) => $m->add('Bad Key', 'X'), 'Invalid attribute key'];
        yield 'choice without options' => [static fn ($m) => $m->add('a', 'X', AttributeType::Choice), 'a choice needs options'];
        yield 'options on a text' => [static fn ($m) => $m->add('a', 'X', AttributeType::Text, ['A']), 'only a choice has options'];
        yield 'unknown option' => [static function ($m): void {
            $m->add('a', 'X', AttributeType::Choice, ['A']);
            $m->rename('a', 'Z', 'Y');
        }, 'has no option "Z"'];
        yield 'rename onto an option' => [static function ($m): void {
            $m->add('a', 'X', AttributeType::Choice, ['A', 'B']);
            $m->rename('a', 'A', 'B');
        }, 'has the option "B" already'];
        yield 'hidden by an unknown key' => [static fn ($m) => $m->add('a', 'X', hiddenWhen: ['nope']), 'No attribute with the key "nope"'];
        yield 'hidden by a text' => [static function ($m): void {
            $m->add('t', 'Text');
            $m->add('a', 'X', hiddenWhen: ['t']);
        }, 'not a yes/no attribute'];
        yield 'hidden by itself' => [static fn ($m) => $m->add('a', 'X', AttributeType::Boolean, hiddenWhen: ['a']), 'names the attribute itself'];
        yield 'option of an unknown attribute' => [static fn ($m) => $m->option('nope', 'A'), 'No attribute with the key "nope"'];
    }

    /** @param callable(object): void $up */
    #[\PHPUnit\Framework\Attributes\DataProvider('mistakes')]
    public function testMistakesAbortWithAClearMessage(callable $up, string $message): void
    {
        $this->expectException(AbortMigration::class);
        $this->expectExceptionMessage($message);
        $migration = $this->migration($up);
        $migration->up(new Schema());
        $migration->getSql();
    }

    public function testHiddenWhenTakesKeysAlsoOfAttributesCreatedLaterAndStoresIds(): void
    {
        $this->em->persist(new Attribute('Entrindet', AttributeType::Boolean));
        $this->em->flush();
        $migration = $this->migration(static function ($m): void {
            $m->add('a', 'A', AttributeType::Boolean, hiddenWhen: ['b']);
            $m->add('b', 'B', AttributeType::Boolean, hiddenWhen: ['a']);
        });
        $this->execute($migration);
        self::assertCount(\count($migration->getSql()), $migration->getSql(), 'asking twice plans nothing twice');
        $this->em->clear();
        $a = $this->em->getRepository(Attribute::class)->findOneBy(['key' => 'a']);
        $b = $this->em->getRepository(Attribute::class)->findOneBy(['key' => 'b']);
        self::assertSame([$b->id->toRfc4122()], $a->hiddenWhen);
        self::assertSame([$a->id->toRfc4122()], $b->hiddenWhen);
    }

    /** The migration after the base one: keys become ids, ids stay, an unknown entry aborts. */
    private function convertHiddenWhen(): void
    {
        require_once __DIR__.'/../../migrations/Version20261119140000.php';
        /** @var class-string<AbstractMigration> $class */
        $class = implode('\\', ['DoctrineMigrations', 'Version20261119140000']);
        $this->execute(new $class($this->connection, new NullLogger()));
        $this->em->clear();
    }

    public function testTheConversionReplacesKeysByIdsAndLeavesIdsAlone(): void
    {
        $sawn = new Attribute('Gesägt', AttributeType::Boolean, key: 'sawn');
        $debarked = new Attribute('Entrindet', AttributeType::Boolean);
        $this->em->persist($sawn);
        $this->em->persist($debarked);
        $this->em->persist(new Attribute('Eins', AttributeType::Text, hiddenWhen: ['sawn']));
        $this->em->persist(new Attribute('Zwei', AttributeType::Text, hiddenWhen: [$debarked->id->toRfc4122(), 'sawn']));
        $this->em->flush();

        $this->convertHiddenWhen();
        $this->convertHiddenWhen();

        $byName = fn (string $name) => $this->em->getRepository(Attribute::class)->findOneBy(['name' => $name]);
        self::assertSame([$sawn->id->toRfc4122()], $byName('Eins')->hiddenWhen);
        $expected = [$sawn->id->toRfc4122(), $debarked->id->toRfc4122()];
        sort($expected);
        self::assertSame($expected, $byName('Zwei')->hiddenWhen);
    }

    public function testTheConversionAbortsOnAKeyWithoutAttribute(): void
    {
        $this->em->persist(new Attribute('Eins', AttributeType::Text, hiddenWhen: ['gone']));
        $this->em->flush();

        $this->expectException(AbortMigration::class);
        $this->expectExceptionMessage('no attribute has that key or id');
        $this->convertHiddenWhen();
    }
}
