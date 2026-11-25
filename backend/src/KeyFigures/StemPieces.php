<?php

namespace App\KeyFigures;

/**
 * The one place that knows which pieces a stem yields: its beams, or the stem itself if it is sawn whole.
 * Also the one rule for "sawn" (dashboard, export, detail view; StemFigures::isSawn()): the checkmark, a beam or a
 * cross-section recorded on the stem. Calculated only, nothing is written.
 *
 * Special case until the migration to beam A (see BACKLOG): a stem sawn whole stays its own piece and has no beam A.
 * After the migration every piece is a beam, and this class shrinks to grouping beams by stem.
 */
final class StemPieces
{
    /** @var array<string, Measures> stems by id, in the order given */
    private array $stems = [];
    /** @var array<string, list<Measures>> beams by stem id, by tag */
    private array $beams = [];

    /** @param list<Measures> $items stems and beams that are not voided; a beam whose stem is not among them is ignored */
    public function __construct(array $items)
    {
        foreach ($items as $item) {
            if (null === $item->parentId) {
                $this->stems[$item->id] = $item;
            } else {
                $this->beams[$item->parentId][] = $item;
            }
        }
        foreach ($this->beams as &$beams) {
            usort($beams, static fn (Measures $a, Measures $b) => ($a->tag ?? "\xff") <=> ($b->tag ?? "\xff"));
        }
    }

    /** @return list<Measures> */
    public function stems(): array
    {
        return array_values($this->stems);
    }

    /** @return list<Measures> */
    public function beamsOf(string $stemId): array
    {
        return $this->beams[$stemId] ?? [];
    }

    public function isSawn(string $stemId): bool
    {
        $stem = $this->stems[$stemId];

        return $stem->sawnMarked || [] !== $this->beamsOf($stemId) || $stem->crossSectionRecorded;
    }

    /** Sawn, but without beams: the stem is its own piece. */
    public function isSawnWhole(string $stemId): bool
    {
        return $this->isSawn($stemId) && [] === $this->beamsOf($stemId);
    }

    /**
     * When a processed stem was processed: "sawn" or "unsawable" first set to yes, whichever came first; without either the cross-section
     * of the stem (both in Measures) or else its first beam. null if there is none. The one rule for the week of the tempo (dashboard) and
     * of the processed stems per week (pile cards).
     */
    public function processedAt(Measures $stem): ?\DateTimeImmutable
    {
        $times = array_filter([$stem->sawnAt, $stem->unsawableAt]) ?: array_filter(array_map(static fn (Measures $beam) => $beam->createdAt, $this->beamsOf($stem->id)));

        return [] === $times ? null : min($times);
    }

    /**
     * @return list<Measures> its beams; the stem itself if sawn whole; none if not sawn
     */
    public function piecesOf(string $stemId): array
    {
        return $this->isSawnWhole($stemId) ? [$this->stems[$stemId]] : $this->beamsOf($stemId);
    }
}
