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

    /**
     * $complete: entries written as "- { name: … }" get the required fields they leave out, so each test only states what it is about.
     */
    private function import(string $yaml, bool $dryRun = false, bool $complete = true): CommandTester
    {
        if ($complete) {
            $yaml = preg_replace_callback('/^(\s*- \{ name: .*) \}$/m', static function (array $m): string {
                foreach (['is_series' => 'false', 'is_inheritable' => 'false', 'applies_to' => '[stem, beam]', 'hidden_when' => '[]'] as $key => $value) {
                    $m[1] .= str_contains($m[1], $key) ? '' : ", $key: $value";
                }

                return $m[1].' }';
            }, $yaml);
        }
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

    public function testExampleFileImportsInFileOrder(): void
    {
        $tester = $this->import(file_get_contents(__DIR__.'/../../data/attributes.example.yaml'));

        self::assertSame(Command::SUCCESS, $tester->getStatusCode(), $tester->getDisplay());
        $attributes = $this->attributes();
        self::assertCount(10, $attributes);
        $species = $attributes['Holzart'];
        self::assertSame([AttributeType::Choice, true, false, 10, true, null], [$species->type, $species->isInheritable, $species->isSeries, $species->sortOrder, $species->active, $species->unit]);
        self::assertSame(['stem'], $species->appliesTo);
        self::assertSame(['beam'], $attributes['Sortierklasse']->appliesTo);
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

    public function testRequiredFieldsHaveNoDefaults(): void
    {
        $tester = $this->import(<<<'YAML'
            - { name: A, type: text, is_inheritable: false, applies_to: [stem], hidden_when: [] }
            - { name: B, type: text, is_series: false, applies_to: [stem], hidden_when: [] }
            - { name: C, type: text, is_series: false, is_inheritable: false, hidden_when: [] }
            - { name: D, type: text, is_series: false, is_inheritable: false, applies_to: [], hidden_when: [] }
            - { name: E, type: text, is_series: false, is_inheritable: false, applies_to: [stem, stem], hidden_when: [] }
            - { name: F, type: text, is_series: false, is_inheritable: false, applies_to: [stem, plank], hidden_when: [] }
            - { name: G, type: text, is_series: false, is_inheritable: false, applies_to: beam, hidden_when: [] }
            - { name: H, type: text, is_series: false, is_inheritable: false, applies_to: [stem] }
            - { name: I, type: text, is_series: false, is_inheritable: false, applies_to: [stem], hidden_when: sawn }
            - { name: J, type: text, is_series: false, is_inheritable: false, applies_to: [stem], hidden_when: [sawn, sawn] }
            YAML, complete: false);

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        $display = preg_replace('/\s+/', ' ', $tester->getDisplay());
        foreach (['"A": is_series is missing', '"B": is_inheritable is missing', '"C": applies_to is missing', '"H": hidden_when is missing',
            '"I": hidden_when must be a list', '"J": hidden_when must be a list'] as $error) {
            self::assertStringContainsString($error, $display);
        }
        foreach (['D', 'E', 'F', 'G'] as $name) {
            self::assertStringContainsString("\"$name\": applies_to must be a list of stem and/or beam", $display);
        }
        self::assertSame([], $this->attributes());
    }

    public function testAppliesToIsStoredAndAChangeShowsInTheDryRun(): void
    {
        $this->import("- { name: Querschnitt, type: text, applies_to: [beam, stem] }\n");
        self::assertSame(['stem', 'beam'], $this->attributes()['Querschnitt']->appliesTo);
        self::assertStringContainsString('unchanged  Querschnitt', $this->import("- { name: Querschnitt, type: text, applies_to: [stem, beam] }\n")->getDisplay());

        $display = $this->import("- { name: Querschnitt, type: text, applies_to: [beam] }\n", true)->getDisplay();
        self::assertStringContainsString('updated    Querschnitt (appliesTo)', $display);
        self::assertSame(['stem', 'beam'], $this->attributes()['Querschnitt']->appliesTo);

        $this->import("- { name: Querschnitt, type: text, applies_to: [beam] }\n");
        self::assertSame(['beam'], $this->attributes()['Querschnitt']->appliesTo);
    }

    public function testHiddenWhenIsStoredAndAChangeShowsInTheDryRun(): void
    {
        $yaml = "- { name: Gesägt, key: sawn, type: boolean, hidden_when: [unsawable] }\n- { name: Nicht sägbar, key: unsawable, type: boolean, hidden_when: %s }\n";
        $this->import(\sprintf($yaml, '[]'));
        self::assertSame(['unsawable'], $this->attributes()['Gesägt']->hiddenWhen);

        $display = $this->import(\sprintf($yaml, '[sawn]'), true)->getDisplay();
        self::assertStringContainsString('updated    Nicht sägbar (hiddenWhen)', $display);
        self::assertStringContainsString('unchanged  Gesägt', $display);
        self::assertSame([], $this->attributes()['Nicht sägbar']->hiddenWhen);

        $this->import(\sprintf($yaml, '[sawn]'));
        self::assertSame(['sawn'], $this->attributes()['Nicht sägbar']->hiddenWhen);
    }

    public function testHiddenWhenMustNameOtherYesNoAttributes(): void
    {
        $this->import("- { name: Entrindet, key: debarked, type: boolean }\n- { name: Länge, key: length, type: text }\n");

        $tester = $this->import(<<<'YAML'
            - { name: Gesägt, key: sawn, type: boolean, hidden_when: [sawn] }
            - { name: A, type: text, hidden_when: [nowhere] }
            - { name: B, type: text, hidden_when: [length] }
            - { name: C, type: text, hidden_when: [notes] }
            - { name: Notiz, key: notes, type: text }
            - { name: Entrindet, type: boolean, hidden_when: [debarked] }
            - { name: Fine, type: text, hidden_when: [sawn, debarked] }
            YAML);

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        $display = preg_replace('/\s+/', ' ', $tester->getDisplay());
        foreach (['"Gesägt": hidden_when must not name the attribute itself (sawn)', '"A": hidden_when names the unknown key nowhere',
            '"B": hidden_when names length, which is of type text', '"C": hidden_when names notes, which is of type text',
            '"Entrindet": hidden_when must not name the attribute itself (debarked)'] as $error) {
            self::assertStringContainsString($error, $display);
        }
        self::assertStringNotContainsString('"Fine"', $display);
        self::assertCount(2, $this->attributes());
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

    public function testKeyIsStoredAndAttributesWithoutOneStayWithout(): void
    {
        $this->import("- { name: Länge, key: length, type: text }\n- { name: Notiz, type: text }\n");

        $attributes = $this->attributes();
        self::assertSame('length', $attributes['Länge']->key);
        self::assertNull($attributes['Notiz']->key);
        self::assertStringContainsString('unchanged  Länge', $this->import("- { name: Länge, key: length, type: text }\n- { name: Notiz, type: text }\n")->getDisplay());
    }

    public function testChangedNameWithKeyRenamesAlsoInDryRun(): void
    {
        $this->import("- { name: Durchmesser, key: diameter, type: number, unit: cm }\n");
        $id = $this->attributes()['Durchmesser']->id;
        $yaml = "- { name: Stammdurchmesser, key: diameter, type: number, unit: cm }\n";

        $display = $this->import($yaml, true)->getDisplay();
        self::assertStringContainsString('renamed    Durchmesser → Stammdurchmesser', $display);
        self::assertSame(['Durchmesser'], array_keys($this->attributes()));

        $this->import($yaml);
        self::assertSame(['Stammdurchmesser'], array_keys($this->attributes()));
        self::assertEquals($id, $this->attributes()['Stammdurchmesser']->id);
        self::assertStringContainsString('unchanged  Stammdurchmesser', $this->import($yaml)->getDisplay());
    }

    public function testKeyIsSetOnAnAttributeWithoutOneMatchedByName(): void
    {
        $this->import("- { name: Notiz, type: text }\n");
        $id = $this->attributes()['Notiz']->id;

        $display = $this->import("- { name: Notiz, key: notes, type: text }\n")->getDisplay();

        self::assertStringContainsString('updated    Notiz (key)', $display);
        self::assertSame('notes', $this->attributes()['Notiz']->key);
        self::assertEquals($id, $this->attributes()['Notiz']->id);
    }

    public function testRefusesAnotherKeyForAnAttributeThatHasOne(): void
    {
        $this->import("- { name: Notiz, key: notes, type: text }\n- { name: Länge, type: text }\n");

        $tester = $this->import("- { name: Notiz, key: remarks, type: text }\n- { name: Länge, type: text, description: Neu }\n");

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        self::assertStringContainsString('"Notiz": key cannot change from notes to remarks', $tester->getDisplay());
        self::assertSame('notes', $this->attributes()['Notiz']->key);
        self::assertSame('', $this->attributes()['Länge']->description, 'nothing is written');
    }

    public function testRefusesRenameOntoTheNameOfAnotherAttribute(): void
    {
        $this->import("- { name: A, key: a, type: text }\n- { name: B, type: text }\n");

        $tester = $this->import("- { name: B, key: a, type: text }\n");

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        self::assertStringContainsString('belongs to another attribute', $tester->getDisplay());
    }

    public function testRefusesDuplicateAndMalformedKeys(): void
    {
        $tester = $this->import(<<<'YAML'
            - { name: A, key: same, type: text }
            - { name: B, key: same, type: text }
            - { name: C, key: Length, type: text }
            - { name: D, key: 1st, type: text }
            - { name: E, key: has-dash, type: text }
            - { name: F, key: 12, type: text }
            - { name: G, key: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: text }
            YAML);

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        $display = preg_replace('/\s+/', ' ', $tester->getDisplay());
        self::assertStringContainsString('"B": key appears more than once', $display);
        foreach (['C', 'D', 'E', 'F', 'G'] as $name) {
            self::assertStringContainsString("\"$name\": key must be lowercase", $display);
        }
        self::assertSame([], $this->attributes());
    }
}
