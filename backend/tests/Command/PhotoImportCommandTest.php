<?php

namespace App\Tests\Command;

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
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Uid\Uuid;

class PhotoImportCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private CommandTester $tester;
    private Attribute $fotos;
    private string $dir;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->tester = new CommandTester((new Application($kernel))->find('app:photo:import'));
        $this->dir = sys_get_temp_dir().'/photo-import-'.bin2hex(random_bytes(4));
        mkdir($this->dir);

        $this->em->persist($admin = new User('Alexander', UserRole::Superadmin, User::hashToken('a')));
        $this->em->persist($this->fotos = new Attribute('Fotos', AttributeType::Photo, isSeries: true));
        $id = Uuid::v7();
        foreach ([[EventType::Created, ['parent_id' => null]], [EventType::TagAssigned, ['tag_number' => '123']]] as [$type, $data]) {
            $this->em->persist(new TimberItemEvent(Uuid::v7(), $id, $type, $data, new \DateTimeImmutable(), $admin));
        }
        $this->em->flush();
        self::getContainer()->get(TimberItemProjector::class)->project($id);
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove([$this->dir, '/tmp/v29-photos-test']);
        parent::tearDown();
    }

    /**
     * @param array<string, string> $files file name => content
     * @param list<list<string>>    $rows
     */
    private function import(array $rows, array $files, bool $dryRun = false, string $separator = ';', string $header = 'file;tag'): int
    {
        foreach ($files as $name => $content) {
            file_put_contents($this->dir.'/'.$name, $content);
        }
        file_put_contents($this->dir.'/photos.csv', "\xEF\xBB\xBF".$header."\n".implode("\n", array_map(static fn (array $row) => implode($separator, $row), $rows))."\n");

        return $this->tester->execute(['csv' => $this->dir.'/photos.csv', '--dry-run' => $dryRun]);
    }

    private function rows(string $table): int
    {
        return $this->em->getConnection()->fetchOne("SELECT COUNT(*) FROM $table");
    }

    private static function jpeg(string $seed = 'a'): string
    {
        return "\xFF\xD8\xFF\xE0".$seed;
    }

    public function testImportAttachesThePhotoToTheItemFoundByTag(): void
    {
        file_put_contents($this->dir.'/a.jpg', self::jpeg());
        touch($this->dir.'/a.jpg', strtotime('2026-09-01 10:00:00 UTC'));

        self::assertSame(Command::SUCCESS, $this->import([['a.jpg', '0123']], []));

        $photo = $this->em->getConnection()->fetchAssociative('SELECT id, size, taken_at FROM photos');
        self::assertSame('2026-09-01 10:00:00.000000', $photo['taken_at']);
        $photoId = Uuid::fromBinary($photo['id'])->toRfc4122();
        self::assertFileEquals($this->dir.'/a.jpg', '/tmp/v29-photos-test/'.substr($photoId, 0, 2).'/'.$photoId.'.jpg');
        $value = $this->em->getConnection()->fetchOne('SELECT JSON_VALUE(data, ?) FROM timber_item_events WHERE type = ?', ['$.value', 'attribute_recorded']);
        self::assertSame($photoId, $value);
        $state = $this->em->getConnection()->fetchOne('SELECT value_records FROM timber_item_state');
        self::assertSame($photoId, json_decode($state, true)[0]['value']);
        self::assertStringContainsString('Imported: 1, skipped: 0', $this->tester->getDisplay());
    }

    public function testRowsThatCannotBeImportedAreSkippedAndReported(): void
    {
        $this->import([['a.jpg', '999'], ['missing.jpg', '123'], ['text.jpg', '123'], ['big.jpg', '123'], ['ok.jpg', '123']], [
            'a.jpg' => self::jpeg(),
            'text.jpg' => 'GIF89a',
            'big.jpg' => self::jpeg().str_repeat('x', 10 * 1024 * 1024),
            'ok.jpg' => self::jpeg('ok'),
        ]);

        $display = preg_replace('/\s+/', ' ', $this->tester->getDisplay());
        foreach (['unknown tag', 'file missing', 'not a JPEG', 'larger than 10 MB', 'Imported: 1, skipped: 4'] as $expected) {
            self::assertStringContainsString($expected, $display);
        }
        self::assertSame(1, $this->rows('photos'));
    }

    public function testCommaSeparatedFileWorksLikeASemicolonFile(): void
    {
        $this->import([['a.jpg', '123']], ['a.jpg' => self::jpeg()], separator: ',', header: 'file,tag');

        self::assertStringContainsString('Imported: 1, skipped: 0', $this->tester->getDisplay());
        self::assertSame(1, $this->rows('photos'));
    }

    public function testQuotedFieldsMayContainTheSeparatorAndDoubledQuotes(): void
    {
        // A file name with a comma and one with a quote character; the semicolon file proves the same for its separator.
        $this->import([['"a, b.jpg"', '"123"'], ['"c ""x"".jpg"', '123']], ['a, b.jpg' => self::jpeg('a'), 'c "x".jpg' => self::jpeg('c')], separator: ',', header: '"file","tag"');

        self::assertStringContainsString('Imported: 2, skipped: 0', $this->tester->getDisplay());
        $this->import([['"d; e.jpg"', '123']], ['d; e.jpg' => self::jpeg('d')]);
        self::assertSame(3, $this->rows('photos'));
    }

    public function testUnknownHeaderIsRefusedNamingBothForms(): void
    {
        self::assertSame(Command::FAILURE, $this->import([['a.jpg', '123']], ['a.jpg' => self::jpeg()], header: 'file|tag'));

        $display = preg_replace('/\s+/', ' ', $this->tester->getDisplay());
        self::assertStringContainsString('"file,tag" or "file;tag"', $display);
        self::assertSame(0, $this->rows('photos'));
    }

    public function testSecondRunCreatesNoDuplicates(): void
    {
        $rows = [['a.jpg', '123'], ['copy.jpg', '123']];
        $files = ['a.jpg' => self::jpeg(), 'copy.jpg' => self::jpeg()];

        $this->import($rows, $files);
        self::assertSame(1, $this->rows('photos'));
        $this->import($rows, $files);

        self::assertSame(1, $this->rows('photos'));
        self::assertSame(1, $this->rows('timber_item_events WHERE type = \'attribute_recorded\''));
        self::assertStringContainsString('already imported', $this->tester->getDisplay());
    }

    public function testDryRunChangesNothing(): void
    {
        $this->import([['a.jpg', '123']], ['a.jpg' => self::jpeg()], dryRun: true);

        self::assertStringContainsString('Would import: 1', $this->tester->getDisplay());
        self::assertSame(0, $this->rows('photos'));
        self::assertSame(0, $this->rows('timber_item_events WHERE type = \'attribute_recorded\''));
        self::assertDirectoryDoesNotExist('/tmp/v29-photos-test');
    }

    public function testWithoutASuperadminNothingIsWritten(): void
    {
        $this->em->getRepository(User::class)->findOneBy(['name' => 'Alexander'])->role = UserRole::Admin;
        $this->em->flush();
        $rows = [['a.jpg', '123']];

        self::assertSame(Command::FAILURE, $this->import($rows, ['a.jpg' => self::jpeg()]));
        self::assertStringContainsString('app:user:role', $this->tester->getDisplay());
        self::assertSame(0, $this->rows('photos'));
    }

    public function testWithoutAPhotoAttributeNothingHappens(): void
    {
        $this->fotos->active = false;
        $this->em->flush();

        self::assertSame(Command::FAILURE, $this->import([['a.jpg', '123']], ['a.jpg' => self::jpeg()]));
        self::assertSame(0, $this->rows('photos'));
    }
}
