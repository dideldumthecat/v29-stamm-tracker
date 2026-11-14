<?php

namespace App\KeyFigures;

/** Why a figure cannot be calculated: the input that is missing, never a sentence. */
enum Missing: string
{
    case Diameter = 'diameter';
    case Length = 'length';
    case CrossSection = 'cross_section';
    case SawnTimber = 'sawn_timber';
    case RoundWood = 'round_wood';
}
