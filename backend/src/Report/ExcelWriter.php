<?php

namespace App\Report;

use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\CellVerticalAlignment;
use OpenSpout\Common\Entity\Style\Color;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\AutoFilter;
use OpenSpout\Writer\Common\Entity\Sheet as WorksheetEntity;
use OpenSpout\Writer\XLSX\Entity\SheetView;
use OpenSpout\Writer\XLSX\Writer;

final class ExcelWriter
{
    public function write(Report $report, string $file): void
    {
        $writer = new Writer();
        $writer->openToFile($file);

        foreach ([$report->stems, $report->beams] as $index => $sheet) {
            $worksheet = 0 === $index ? $writer->getCurrentSheet() : $writer->addNewSheetAndMakeItCurrent();
            $worksheet->setName($sheet->name);
            $worksheet->setSheetView(new SheetView(freezeRow: 2, freezeColumn: 'B'));
            $worksheet->setAutoFilter(new AutoFilter(0, 1, \count($sheet->headers) - 1, \count($sheet->rows) + 1));
            $this->setWidths($worksheet, $sheet);
            $writer->addRow($this->headerRow($sheet));
            $writer->addRows($this->rows($sheet));
        }

        $notes = $report->notes;
        $worksheet = $writer->addNewSheetAndMakeItCurrent();
        $worksheet->setName($notes->name);
        $this->setWidths($worksheet, $notes);
        $writer->addRow(new Row([Cell::fromValue('Stand: '.$report->exportedAt->format('d.m.Y H:i'), new Style(fontBold: true))]));
        $writer->addRow(Row::fromValues(['']));
        $writer->addRow($this->headerRow($notes));
        $writer->addRows($this->rows($notes));

        $writer->close();
    }

    private function setWidths(WorksheetEntity $worksheet, Sheet $sheet): void
    {
        foreach ($sheet->columnWidths() as $index => $width) {
            $worksheet->setColumnWidth($width, $index + 1);
        }
    }

    private function headerRow(Sheet $sheet): Row
    {
        $style = new Style(fontBold: true, fontColor: Color::WHITE, backgroundColor: Color::BLACK, shouldWrapText: true, cellVerticalAlignment: CellVerticalAlignment::TOP);

        return new Row(array_map(static fn (string $header) => Cell::fromValue($header, $style), $sheet->headers));
    }

    /** @return list<Row> */
    private function rows(Sheet $sheet): array
    {
        return array_map(function (array $values) use ($sheet) {
            $cells = [];
            foreach ($sheet->headers as $index => $_) {
                $value = $values[$index] ?? null;
                $wrap = !\in_array($index, $sheet->unwrapped, true) && \is_string($value) && (mb_strlen($value) > Sheet::MAX_WIDTH || str_contains($value, "\n"));
                $cells[] = Cell::fromValue($value, new Style(format: $sheet->formats[$index], shouldWrapText: $wrap ?: null, cellVerticalAlignment: CellVerticalAlignment::TOP));
            }

            return new Row($cells);
        }, $sheet->rows);
    }
}
