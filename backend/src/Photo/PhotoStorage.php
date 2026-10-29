<?php

namespace App\Photo;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;

/**
 * Photos live outside public/ and are served by PhotoController only. The file name is the photo id.
 */
final class PhotoStorage
{
    public const MAX_BYTES = 10 * 1024 * 1024;

    public function __construct(#[Autowire('%photo_dir%')] private readonly string $dir)
    {
    }

    public function path(Uuid $id): string
    {
        $name = $id->toRfc4122();

        return \sprintf('%s/%s/%s.jpg', $this->dir, substr($name, 0, 2), $name);
    }

    public function isJpeg(string $file): bool
    {
        return "\xFF\xD8\xFF" === file_get_contents($file, length: 3);
    }

    public function store(Uuid $id, string $source): void
    {
        $target = $this->path($id);
        if (!is_dir(\dirname($target)) && !mkdir(\dirname($target), 0750, true) && !is_dir(\dirname($target))) {
            throw new \RuntimeException(\sprintf('Cannot create "%s".', \dirname($target)));
        }
        // Temporary name in the same folder, so rename() is atomic and a half-written file never carries the real name.
        $temporary = $target.'.'.bin2hex(random_bytes(4)).'.tmp';
        if (!copy($source, $temporary) || !rename($temporary, $target)) {
            @unlink($temporary);
            throw new \RuntimeException(\sprintf('Cannot write "%s".', $target));
        }
    }

    public function remove(Uuid $id): void
    {
        @unlink($this->path($id));
    }
}
