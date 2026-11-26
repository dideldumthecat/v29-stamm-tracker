<?php

namespace App\Tests\User;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\User;
use App\Entity\UserGroup;
use App\Entity\UserRole;
use App\User\UserGroups;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

class UserGroupsTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private UserGroups $groups;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->groups = self::getContainer()->get(UserGroups::class);
    }

    public function testTheDefaultIsTheGroupV29ThatSeesAll(): void
    {
        $this->em->persist(new UserGroup('Anna', true));
        $this->em->persist($partial = new UserGroup('V29', false));
        $this->em->persist($named = new UserGroup('Zimmerei', true));
        $this->em->flush();
        // "V29" exists, but sees only some: not the default
        self::assertSame('Anna', $this->groups->default()?->name);

        $partial->name = 'Zeta';
        $this->em->flush();
        $named->name = 'V29';
        $this->em->flush();
        self::assertSame($named, $this->groups->default());
    }

    public function testWithoutAGroupNamedV29TheFirstByNameIsTheDefault(): void
    {
        $this->em->persist(new UserGroup('Zimmerei', true));
        $this->em->persist($first = new UserGroup('Bau', false));
        $this->em->flush();

        self::assertSame($first, $this->groups->default());
    }

    public function testNoGroupNoDefault(): void
    {
        self::assertNull($this->groups->default());
    }

    public function testAGroupHidesTheAttributesItDoesNotEnableInTheirOrder(): void
    {
        foreach ([['Notiz', 30], ['Holzart', 10], ['Entrindet', 20], ['Länge', 40]] as [$name, $order]) {
            $this->em->persist($attributes[$name] = new Attribute($name, AttributeType::Text, sortOrder: $order));
        }
        $this->em->persist($some = new UserGroup('Sägewerk', false));
        $some->enable([$attributes['Holzart'], $attributes['Länge']]);
        $this->em->persist($all = new UserGroup('V29', true));
        $all->enable([$attributes['Holzart']]);
        $this->em->persist($sawyer = new User('Eulitz', UserRole::User, $some, 'a'));
        $this->em->persist($boss = new User('Alexander', UserRole::Superadmin, $all, 'b'));
        $this->em->flush();

        self::assertSame([$attributes['Entrindet']->id->toRfc4122(), $attributes['Notiz']->id->toRfc4122()], $this->groups->hiddenAttributeIds($sawyer));
        self::assertSame([], $this->groups->hiddenAttributeIds($boss), 'a group that sees all hides nothing, whatever its list holds');
    }
}
