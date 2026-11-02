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
    // Server only (app:item:restore): lifts the voided event it points to. The app never sends it, the sync refuses it.
    case Restored = 'restored';
}
