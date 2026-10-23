<?php

namespace App\Entity;

enum EventType: string
{
    case Created = 'created';
    case AttributeRecorded = 'attribute_recorded';
    case TagAssigned = 'tag_assigned';
    // Corrections and voids are created in the administration only and point to the event they replace.
    case Corrected = 'corrected';
    case Voided = 'voided';
}
