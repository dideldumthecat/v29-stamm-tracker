<?php

namespace App\Tests\Entity;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

class AttributeTest extends KernelTestCase
{
    /** @return iterable<string, array{string, bool}> */
    public static function keys(): iterable
    {
        yield 'letters' => ['length', true];
        yield 'digits and underscores' => ['mid_diameter_2', true];
        yield 'longest' => [str_repeat('a', 64), true];
        yield 'too long' => [str_repeat('a', 65), false];
        yield 'empty' => ['', false];
        yield 'uppercase' => ['Length', false];
        yield 'starts with a digit' => ['2nd', false];
        yield 'starts with an underscore' => ['_x', false];
        yield 'dash' => ['mid-diameter', false];
        yield 'umlaut' => ['länge', false];
        yield 'trailing newline' => ["length\n", false];
    }

    #[DataProvider('keys')]
    public function testKeyFormat(string $key, bool $valid): void
    {
        self::assertSame($valid, Attribute::isValidKey($key));
        if (!$valid) {
            $this->expectException(\InvalidArgumentException::class);
            new Attribute('X', AttributeType::Text, key: $key);
        }
    }

    public function testKeyNeverChangesOnceSet(): void
    {
        $attribute = new Attribute('Länge', AttributeType::Text);
        $attribute->assignKey('length');
        $attribute->assignKey('length');

        $this->expectException(\InvalidArgumentException::class);
        $attribute->assignKey('size');
    }

    public function testDatabaseRejectsADuplicateKeyButAllowsSeveralWithoutOne(): void
    {
        $em = self::getContainer()->get(EntityManagerInterface::class);
        $em->persist(new Attribute('A', AttributeType::Text));
        $em->persist(new Attribute('B', AttributeType::Text));
        $em->persist(new Attribute('C', AttributeType::Text, key: 'notes'));
        $em->flush();

        $em->persist(new Attribute('D', AttributeType::Text, key: 'notes'));
        $this->expectException(UniqueConstraintViolationException::class);
        $em->flush();
    }
}
