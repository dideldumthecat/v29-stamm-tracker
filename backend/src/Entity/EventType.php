<?php

namespace App\Entity;

enum EventType: string
{
    case Created = 'created';
    case AttributeRecorded = 'attribute_recorded';
    case TagAssigned = 'tag_assigned';
    // Created by the app for a beam, or by console command; points to the event it voids.
    case Voided = 'voided';
    // Server only (app:item:restore): lifts the voided event it points to. The app never sends it, the sync refuses it.
    case Restored = 'restored';
}
