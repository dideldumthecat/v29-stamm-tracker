<?php

namespace App\Tests\Migration;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\Pile;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;
use Doctrine\Migrations\Exception\AbortMigration;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/** Version20261120190000: the master data of the pile 01. */
class PileDataMigrationTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Attribute $source;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->em->persist($this->source = new Attribute('Polternummer', AttributeType::Choice, key: 'source'));
    }

    private function migrate(): void
    {
        $this->em->flush();
        require_once __DIR__.'/../../migrations/Version20261120190000.php';
        /** @var class-string<AbstractMigration> $class */
        $class = implode('\\', ['DoctrineMigrations', 'Version20261120190000']);
        $migration = new $class($this->em->getConnection(), new NullLogger());
        $migration->up(new Schema());
        foreach ($migration->getSql() as $query) {
            $this->em->getConnection()->executeStatement($query->getStatement(), $query->getParameters(), $query->getTypes());
        }
        $this->em->clear();
    }

    private function option(string $label, int $order = 10): AttributeOption
    {
        $this->em->persist($option = new AttributeOption($this->source, $label, $order));

        return $option;
    }

    public function testGivesThePileItsDataAndTheDerivedLabel(): void
    {
        $other = $this->option('02', 20);
        $option = $this->option('01 (0101/0145)');

        $this->migrate();

        $option = $this->em->find(AttributeOption::class, $option->id);
        self::assertSame('2601-010145 (Krummes F)', $option->label);
        $pile = $this->em->find(Pile::class, $option->id);
        self::assertSame(['2601-010145', 'Krummes F', '51.413056', '13.060556', '51.52'], [$pile->number, $pile->location, $pile->latitude, $pile->longitude, $pile->stackedVolume]);
        self::assertSame('02', $this->em->find(AttributeOption::class, $other->id)->label);
        self::assertNull($this->em->find(Pile::class, $other->id));
    }

    public function testChangesNothingOnAnEmptyDatabase(): void
    {
        $this->em->remove($this->source);

        $this->migrate();

        self::assertSame([], $this->em->getRepository(Pile::class)->findAll());
    }

    public function testAbortsWithoutTheOption(): void
    {
        $this->option('02');

        $this->expectException(AbortMigration::class);
        $this->expectExceptionMessage('There is no option "01 (0101/0145)"');
        $this->migrate();
    }

    public function testAbortsWhenTheOptionHasAPileRowAlready(): void
    {
        $option = $this->option('01 (0101/0145)');
        $this->em->persist(new Pile($option, '2601-000001'));

        $this->expectException(AbortMigration::class);
        $this->expectExceptionMessage('has master data already');
        $this->migrate();
    }
}
