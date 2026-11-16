<?php

namespace App\Attributes;

/** Request that breaks a rule of AttributeEditor; the messages are German, ready for display. */
final class InvalidAttribute extends \RuntimeException
{
    /** @param list<array{field: string, message: string}> $errors */
    public function __construct(public readonly array $errors)
    {
        parent::__construct(implode(' ', array_column($errors, 'message')));
    }
}
