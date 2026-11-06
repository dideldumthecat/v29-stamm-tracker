<?php

namespace App\Command;

use App\Entity\Attribute;
use App\Entity\TimberItem;
use Doctrine\ORM\EntityManagerInterface;

/**
 * What app:attribute:set and app:attribute:clear share: reading --range, finding the attribute by key or name, and the stems.
 */
class StemSelection
{
    public const MAX_TAG_NUMBER = 1999;

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /**
     * @return list<int>|false|null the requested tag numbers, null for "all", false if the text is not a range
     */
    public function parseRange(string $range): array|false|null
    {
        if ('all' === $range) {
            return null;
        }
        $numbers = [];
        foreach (explode(',', $range) as $part) {
            if (!preg_match('/^\s*0*(\d+)\s*(?:-\s*0*(\d+)\s*)?$/', $part, $m)) {
                return false;
            }
            [$from, $to] = [(int) $m[1], (int) ($m[2] ?? $m[1])];
            if ($from < 1 || $from > $to || $to > self::MAX_TAG_NUMBER) {
                return false;
            }
            array_push($numbers, ...range($from, $to));
        }

        return array_values(array_unique($numbers));
    }

    public function notARange(string $range): string
    {
        return \sprintf('"%s" is not a range. Use all, 119, 1-10 or 1-10,15,20-25 (numbers 1 to %d).', $range, self::MAX_TAG_NUMBER);
    }

    /**
     * @param string $keyOrName the attribute's key, else its exact name
     */
    public function attribute(string $keyOrName): ?Attribute
    {
        // The database compares case-insensitively; "exact" is checked here.
        $repository = $this->em->getRepository(Attribute::class);

        return array_find($repository->findBy(['key' => $keyOrName]), static fn (Attribute $a) => $a->key === $keyOrName)
            ?? array_find($repository->findBy(['name' => $keyOrName]), static fn (Attribute $a) => $a->name === $keyOrName);
    }

    /**
     * @return array<int, TimberItem> voided stems and beams left out, by tag number
     */
    public function stems(): array
    {
        $stems = [];
        foreach ($this->em->getRepository(TimberItem::class)->findBy(['parentId' => null, 'voidedAt' => null]) as $stem) {
            if (null !== $stem->tagNumber) {
                $stems[(int) $stem->tagNumber] = $stem;
            }
        }

        return $stems;
    }
}
