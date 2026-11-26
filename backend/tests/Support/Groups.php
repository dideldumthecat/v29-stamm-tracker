<?php

namespace App\Tests\Support;

use App\Entity\UserGroup;
use Doctrine\ORM\EntityManagerInterface;

/** The group of the test users: "V29" as the migration creates it, or a new one in a database without it (rolled back with the test). */
final class Groups
{
    public static function v29(EntityManagerInterface $em): UserGroup
    {
        $group = $em->getRepository(UserGroup::class)->findOneBy(['name' => 'V29']);
        if (!$group) {
            // Flushed at once: the next call must find it.
            $em->persist($group = new UserGroup('V29', true));
            $em->flush();
        }

        return $group;
    }
}
