<?php

namespace App\Entity;

/**
 * Same values as AttributeType in frontend/shared/contract.ts.
 */
enum AttributeType: string
{
    case Boolean = 'boolean';
    case Choice = 'choice';
    case Number = 'number';
    case Text = 'text';
    case Date = 'date';
    case Month = 'month';
    case Photo = 'photo';
}
