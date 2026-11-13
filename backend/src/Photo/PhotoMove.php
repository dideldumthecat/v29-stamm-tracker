<?php

namespace App\Photo;

use Symfony\Component\Uid\Uuid;

/**
 * One photo of a PhotoMover run: where it is now and where it goes.
 */
final readonly class PhotoMove
{
    public function __construct(
        public Uuid $photoId,
        public \DateTimeImmutable $takenAt,
        public Uuid $sourceId,
        public ?string $sourceTag,
        public ?string $targetTag,
        /** The attribute_recorded event that puts the photo on its source; the move voids it. */
        public Uuid $recordingId,
        public bool $alreadyAtTarget,
    ) {
    }
}
