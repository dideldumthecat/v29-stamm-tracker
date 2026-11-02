<?php

namespace App\Command;

use App\Report\ExcelWriter;
use App\Report\TimberReport;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Key figures as Excel (stems, beams, notes), see TimberReport. The headings are German: they are content for V29.
 */
#[AsCommand(name: 'app:export', description: 'Write the evaluation (stems, beams, yield) to an Excel file')]
class ExportCommand
{
    public function __construct(private readonly TimberReport $report, private readonly ExcelWriter $writer)
    {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Target file; default stamm-tracker-export-YYYY-MM-DD-HHMM.xlsx (Berlin time) in the current directory')] ?string $file = null,
    ): int {
        $now = new \DateTimeImmutable('now', new \DateTimeZone('Europe/Berlin'));
        $file ??= \sprintf('%s/stamm-tracker-export-%s.xlsx', getcwd(), $now->format('Y-m-d-Hi'));

        try {
            $report = $this->report->build($now);
        } catch (\RuntimeException $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }
        $this->writer->write($report, $file);

        foreach ($report->warnings as $warning) {
            $io->warning($warning);
        }
        $io->success(\sprintf('%s: %d stems, %d rows on "%s".', $file, \count($report->stems->rows), \count($report->beams->rows), $report->beams->name));

        return Command::SUCCESS;
    }
}
