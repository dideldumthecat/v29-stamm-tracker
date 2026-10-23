<?php

namespace App\Entity;

enum UserRole: string
{
    case User = 'user';
    case Admin = 'admin';
}
