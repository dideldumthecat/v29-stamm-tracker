<?php

namespace App\Report;

final readonly class Report
{
    /**
     * @param Sheet        $notes    Kategorie | Spalte | Bedeutung
     * @param list<string> $warnings texts that could not be read as numbers
     */
    public function __construct(
        public Sheet $stems,
        public Sheet $beams,
        public Sheet $notes,
        public \DateTimeImmutable $exportedAt,
        public array $warnings,
    ) {
    }
}
