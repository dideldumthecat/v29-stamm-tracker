<?php

namespace App\Entity;

enum EventType: string
{
    case Created = 'created';
    case AttributeRecorded = 'attribute_recorded';
    case TagAssigned = 'tag_assigned';
    // Corrections are created in the administration only; a void also by the app, for a beam. Both point to the event they replace.
    case Corrected = 'corrected';
    case Voided = 'voided';
}
