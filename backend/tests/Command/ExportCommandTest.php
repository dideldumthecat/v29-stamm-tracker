<?php

namespace App\Tests\Command;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use Doctrine\ORM\EntityManagerInterface;
use OpenSpout\Reader\XLSX\Reader;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

class ExportCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private CommandTester $tester;
    private string $file;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->file = tempnam(sys_get_temp_dir(), 'export').'.xlsx';
        $this->tester = new CommandTester((new Application($kernel))->find('app:export'));
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
        parent::tearDown();
    }

    private function keyedAttributes(string ...$except): void
    {
        $types = ['mid_diameter_max' => AttributeType::Number, 'mid_diameter_min' => AttributeType::Number, 'length' => AttributeType::Choice, 'sawn' => AttributeType::Boolean,
            'sawn_cross_section' => AttributeType::Choice, 'notes' => AttributeType::Text, 'photos' => AttributeType::Photo];
        foreach (array_diff_key($types, array_flip($except)) as $key => $type) {
            $this->em->persist(new Attribute($key, $type, key: $key));
        }
        $this->em->flush();
    }

    public function testWritesThreeSheets(): void
    {
        $this->keyedAttributes();

        $this->tester->execute(['file' => $this->file]);

        self::assertSame(Command::SUCCESS, $this->tester->getStatusCode());
        self::assertStringContainsString($this->file.': 0 stems, 0 rows on "Balken".', $this->tester->getDisplay());
        $reader = new Reader();
        $reader->open($this->file);
        $names = [];
        foreach ($reader->getSheetIterator() as $sheet) {
            $names[] = $sheet->getName();
        }
        $reader->close();
        self::assertSame(['Stämme', 'Balken', 'Hinweise'], $names);
    }

    public function testMissingKeyFailsWithoutFile(): void
    {
        $this->keyedAttributes('length');
        unlink($this->file);

        $this->tester->execute(['file' => $this->file]);

        self::assertSame(Command::FAILURE, $this->tester->getStatusCode());
        self::assertStringContainsString('Missing in the database: length.', $this->tester->getDisplay());
        self::assertFileDoesNotExist($this->file);
    }

    public function testDefaultFileNameInCurrentDirectory(): void
    {
        $this->keyedAttributes();
        $directory = sys_get_temp_dir().'/export-'.bin2hex(random_bytes(4));
        mkdir($directory);
        $previous = getcwd();
        chdir($directory);
        try {
            $this->tester->execute([]);
            $files = glob($directory.'/*');
        } finally {
            chdir($previous);
        }

        self::assertSame(Command::SUCCESS, $this->tester->getStatusCode());
        self::assertCount(1, $files);
        self::assertMatchesRegularExpression('/stamm-tracker-export-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/', $files[0]);
        unlink($files[0]);
        rmdir($directory);
    }
}
