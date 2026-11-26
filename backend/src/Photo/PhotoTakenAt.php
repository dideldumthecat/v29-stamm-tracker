<?php

namespace App\Photo;

use App\Api\Timestamp;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/** When the uploaded photos were taken, for the snapshot. A photo not uploaded yet has no entry. */
final class PhotoTakenAt
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /** @return array<string, string> photo id (RFC 4122) → capture time as in the API */
    public function byPhotoId(): array
    {
        $times = [];
        foreach ($this->em->getConnection()->fetchAllKeyValue('SELECT id, taken_at FROM photos') as $id => $time) {
            $times[Uuid::fromBinary((string) $id)->toRfc4122()] = Timestamp::format(new \DateTimeImmutable((string) $time, new \DateTimeZone('UTC')));
        }

        return $times;
    }
}
