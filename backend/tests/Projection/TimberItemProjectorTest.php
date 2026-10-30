<?php

namespace App\Tests\Projection;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Uid\Uuid;

class TimberItemProjectorTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private TimberItemProjector $projector;
    private User $user;
    private Attribute $diameter;
    private Attribute $notes;
    private int $clock = 0;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->projector = self::getContainer()->get(TimberItemProjector::class);
        $this->em->persist($this->user = new User('Kerstin', UserRole::Admin, User::hashToken('t')));
        $this->em->persist($this->diameter = new Attribute('Durchmesser', AttributeType::Number, isInheritable: true));
        $this->em->persist($this->notes = new Attribute('Notiz', AttributeType::Text, isSeries: true));
        $this->em->flush();
    }

    /** Every event is received one second after the previous one: the receipt order is the call order. */
    private function event(Uuid $item, EventType $type, array $data, ?Uuid $reference = null): Uuid
    {
        $id = Uuid::v7();
        $at = (new \DateTimeImmutable('2026-10-20 08:00:00 UTC'))->modify('+'.++$this->clock.' seconds');
        $this->em->persist(new TimberItemEvent($id, $item, $type, $data, $at, $this->user, $reference, $at));

        return $id;
    }

    private function item(string $tag, ?Uuid $parent = null): Uuid
    {
        $item = Uuid::v7();
        $this->event($item, EventType::Created, ['parent_id' => $parent?->toRfc4122()]);
        $this->event($item, EventType::TagAssigned, ['tag_number' => $tag]);

        return $item;
    }

    private function record(Uuid $item, mixed $value, ?Attribute $attribute = null): Uuid
    {
        return $this->event($item, EventType::AttributeRecorded, ['attribute_id' => ($attribute ?? $this->diameter)->id->toRfc4122(), 'value' => $value]);
    }

    /** @return list<mixed> the item's current values of the attribute */
    private function values(Uuid $item, ?Attribute $attribute = null): array
    {
        $this->em->flush();
        $json = $this->em->getConnection()->fetchOne(
            'SELECT value_records FROM timber_item_state WHERE timber_item_id = ? AND attribute_id = ?',
            [$item->toBinary(), ($attribute ?? $this->diameter)->id->toBinary()],
        );

        return $json ? array_column(json_decode($json, true), 'value') : [];
    }

    private function isListed(Uuid $item): bool
    {
        return (bool) $this->em->getConnection()->fetchOne('SELECT 1 FROM timber_items WHERE id = ? AND voided_at IS NULL', [$item->toBinary()]);
    }

    private function projectAll(Uuid ...$items): void
    {
        $this->em->flush();
        foreach ($items as $item) {
            $this->projector->project($item);
        }
    }

    public function testAVoidedRecordingIsIgnoredAlthoughItsVoidIsReceivedLater(): void
    {
        $stem = $this->item('1');
        $recording = $this->record($stem, 30);
        $this->projectAll($stem);
        self::assertSame([30], $this->values($stem));

        $this->event($stem, EventType::Voided, [], $recording);
        $this->projectAll($stem);

        self::assertSame([], $this->values($stem));
        self::assertTrue($this->isListed($stem), 'the item itself stays');
    }

    public function testOnlyTheReferencedRecordingIsVoided(): void
    {
        $stem = $this->item('1');
        $first = $this->record($stem, 1, $this->notes);
        $this->record($stem, 2, $this->notes);
        $this->record($stem, 40);
        $this->event($stem, EventType::Voided, [], $first);
        $this->projectAll($stem);

        self::assertSame([2], $this->values($stem, $this->notes));
        self::assertSame([40], $this->values($stem));
    }

    public function testAnOlderRecordingResurfacesOnlyIfJustTheLatestIsVoided(): void
    {
        $stem = $this->item('1');
        $older = $this->record($stem, 20);
        $latest = $this->record($stem, 30);
        $this->event($stem, EventType::Voided, [], $latest);
        $this->projectAll($stem);
        self::assertSame([20], $this->values($stem), 'which is why app:attribute:clear voids every recording');

        $this->event($stem, EventType::Voided, [], $older);
        $this->projectAll($stem);
        self::assertSame([], $this->values($stem));
    }

    public function testAVoidOfTheItemStaysAnItemVoid(): void
    {
        $stem = $this->item('1');
        $this->em->flush();
        $created = Uuid::fromBinary($this->em->getConnection()->fetchOne('SELECT id FROM timber_item_events WHERE timber_item_id = ? AND type = ?', [$stem->toBinary(), 'created']));
        $this->record($stem, 30);
        $this->event($stem, EventType::Voided, [], $created);
        $this->projectAll($stem);

        self::assertFalse($this->isListed($stem));
    }

    public function testABeamNoLongerInheritsAVoidedStemValueButKeepsItsOwn(): void
    {
        $stem = $this->item('1');
        $beam = $this->item('1-A', $stem);
        $own = $this->item('1-B', $stem);
        $recording = $this->record($stem, 30);
        $this->record($own, 25);
        $this->projectAll($stem, $beam, $own);
        self::assertSame([30], $this->values($beam));

        $this->event($stem, EventType::Voided, [], $recording);
        $this->projectAll($stem);

        self::assertSame([], $this->values($beam));
        self::assertSame([25], $this->values($own));
    }

    public function testAVoidedRecordingOnABeamDoesNotCountAsAVoidedBeam(): void
    {
        $stem = $this->item('1');
        $beam = $this->item('1-A', $stem);
        $this->event($beam, EventType::Voided, [], $this->record($beam, 25));
        $this->projectAll($beam, $stem);

        self::assertTrue($this->isListed($beam));
        self::assertTrue((bool) $this->em->getConnection()->fetchOne('SELECT has_children FROM timber_items WHERE id = ?', [$stem->toBinary()]));
    }

    public function testRebuildGivesTheSameState(): void
    {
        $stem = $this->item('1');
        $beam = $this->item('1-A', $stem);
        $this->record($stem, 20);
        $this->event($stem, EventType::Voided, [], $this->record($stem, 30));
        $this->event($stem, EventType::Voided, [], $this->record($stem, 40, $this->notes));
        $this->projectAll($stem, $beam);
        $state = fn () => $this->em->getConnection()->fetchAllAssociative('SELECT HEX(timber_item_id) item, HEX(attribute_id) attr, value_records FROM timber_item_state ORDER BY 1, 2');
        $before = $state();
        self::assertSame([20], $this->values($beam));

        $this->projector->rebuildAll();

        self::assertSame($before, $state());
    }
}
