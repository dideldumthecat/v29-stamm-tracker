<?php

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

class PingControllerTest extends WebTestCase
{
    public function testPingAnswersWithJson(): void
    {
        $client = static::createClient();
        $client->request('GET', '/api/ping');

        self::assertResponseStatusCodeSame(200);
        self::assertSame(['ok' => true], json_decode($client->getResponse()->getContent(), true));
    }
}
