<?php

namespace App\Tests\Command;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Uid\Uuid;

class AttributesImportCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Application $application;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->application = new Application($kernel);
    }

    private function import(string $yaml, bool $dryRun = false): CommandTester
    {
        $file = tempnam(sys_get_temp_dir(), 'attributes');
        file_put_contents($file, $yaml);
        $tester = new CommandTester($this->application->find('app:attributes:import'));
        $tester->execute(['file' => $file, '--dry-run' => $dryRun]);
        unlink($file);
        $this->em->clear();

        return $tester;
    }

    /** @return array<string, Attribute> */
    private function attributes(): array
    {
        return array_column($this->em->getRepository(Attribute::class)->findAll(), null, 'name');
    }

    /** @return array<string, AttributeOption> */
    private function options(Attribute $attribute): array
    {
        return array_column($this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $attribute]), null, 'label');
    }

    public function testExampleFileImportsWithDefaultsAndFileOrder(): void
    {
        $tester = $this->import(file_get_contents(__DIR__.'/../../data/attributes.example.yaml'));

        self::assertSame(Command::SUCCESS, $tester->getStatusCode(), $tester->getDisplay());
        $attributes = $this->attributes();
        self::assertCount(10, $attributes);
        $species = $attributes['Holzart'];
        self::assertSame([AttributeType::Choice, true, false, 10, true, null], [$species->type, $species->isInheritable, $species->isSeries, $species->sortOrder, $species->active, $species->unit]);
        self::assertSame('%', $attributes['Holzfeuchte']->unit);
        self::assertSame(20, $attributes['Fälldatum']->sortOrder);
        $options = $this->options($species);
        self::assertSame([10, 20, 30], [$options['Traubeneiche']->sortOrder, $options['Stieleiche']->sortOrder, $options['Roteiche']->sortOrder]);
        self::assertFalse($options['Roteiche']->active);
    }

    public function testSecondImportOfTheSameFileChangesNothing(): void
    {
        $yaml = file_get_contents(__DIR__.'/../../data/attributes.example.yaml');
        $this->import($yaml);
        $before = $this->em->getConnection()->fetchAllAssociative('SELECT * FROM attributes a LEFT JOIN attribute_options o ON o.attribute_id = a.id ORDER BY a.id, o.id');

        $display = $this->import($yaml)->getDisplay();

        self::assertSame(10, substr_count($display, 'unchanged  '));
        self::assertStringNotContainsString('created', $display);
        self::assertStringNotContainsString('updated', $display);
        self::assertSame($before, $this->em->getConnection()->fetchAllAssociative('SELECT * FROM attributes a LEFT JOIN attribute_options o ON o.attribute_id = a.id ORDER BY a.id, o.id'));
    }

    public function testUpdatesInPlaceKeepsIdsAndListsWhatIsNotInFile(): void
    {
        $this->import("- { name: Holzart, type: choice, options: [Traubeneiche, Stieleiche] }\n- { name: Notiz, type: text }\n");
        $species = $this->attributes()['Holzart'];
        $oakId = $this->options($species)['Traubeneiche']->id;

        $display = $this->import("- { name: Holzart, type: choice, description: Neu, options: [Roteiche, { label: Traubeneiche, active: false }] }\n")->getDisplay();

        $updated = $this->attributes()['Holzart'];
        self::assertEquals($species->id, $updated->id);
        self::assertSame('Neu', $updated->description);
        $options = $this->options($updated);
        self::assertEquals($oakId, $options['Traubeneiche']->id);
        self::assertFalse($options['Traubeneiche']->active);
        self::assertSame(20, $options['Traubeneiche']->sortOrder);
        self::assertSame(10, $options['Roteiche']->sortOrder);
        self::assertTrue($options['Stieleiche']->active);
        self::assertStringContainsString('updated    Holzart', $display);
        self::assertStringContainsString('option not in file: Stieleiche', $display);
        self::assertStringContainsString('not in file  Notiz', $display);
        self::assertArrayHasKey('Notiz', $this->attributes());

        self::assertStringContainsString('unchanged  Holzart', $this->import("- { name: Holzart, type: choice, description: Neu, options: [Roteiche, { label: Traubeneiche, active: false }] }\n")->getDisplay());
    }

    public function testDryRunWritesNothing(): void
    {
        $this->import("- { name: Notiz, type: text }\n");

        $display = $this->import("- { name: Notiz, type: text, description: Neu }\n- { name: Holzart, type: choice, options: [A] }\n", true)->getDisplay();

        self::assertStringContainsString('updated    Notiz', $display);
        self::assertStringContainsString('created    Holzart', $display);
        self::assertSame(['Notiz'], array_keys($this->attributes()));
        self::assertSame('', $this->attributes()['Notiz']->description);
    }

    public function testInvalidFileImportsNothingAndNamesEachAttribute(): void
    {
        $tester = $this->import(<<<'YAML'
            - { name: Gut, type: text }
            - { name: Farbe, type: colour }
            - { name: Länge, type: text, unit: m, colour: red }
            - { name: Art, type: choice }
            - { name: Notiz, type: text, options: [A] }
            - { name: Klasse, type: choice, options: [A, A] }
            - { name: Gut, type: text }
            - { name: Fotos, type: photo }
            YAML);

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        $display = preg_replace('/\s+/', ' ', $tester->getDisplay());
        foreach (['"Farbe": type must be', '"Länge": unknown key colour', '"Länge": unit is only allowed', '"Art": type choice needs options',
            '"Notiz": options are only allowed', '"Klasse": option "A" appears more than once', '"Gut": name appears more than once', '"Fotos": type photo needs is_series'] as $error) {
            self::assertStringContainsString($error, $display);
        }
        self::assertSame([], $this->attributes());
    }

    public function testRefusesTypeChangeOnceValuesWereRecorded(): void
    {
        $this->import("- { name: Notiz, type: text }\n- { name: Länge, type: text }\n");
        $user = new User('Kerstin', UserRole::User, User::hashToken('t'));
        $this->em->persist($user);
        $this->em->persist(new TimberItemEvent(Uuid::v7(), Uuid::v7(), EventType::AttributeRecorded,
            ['attribute_id' => $this->attributes()['Notiz']->id->toRfc4122(), 'value' => 'x'], new \DateTimeImmutable(), $user));
        $this->em->flush();

        $tester = $this->import("- { name: Notiz, type: number }\n- { name: Länge, type: number, unit: m }\n");

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        self::assertStringContainsString('"Notiz": type cannot change', $tester->getDisplay());
        self::assertSame(AttributeType::Text, $this->attributes()['Länge']->type);

        self::assertSame(Command::SUCCESS, $this->import("- { name: Länge, type: number, unit: m }\n")->getStatusCode());
        self::assertSame(AttributeType::Number, $this->attributes()['Länge']->type);
    }
}
