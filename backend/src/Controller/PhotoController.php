<?php

namespace App\Controller;

use App\Api\Timestamp;
use App\Entity\Photo;
use App\Entity\User;
use App\Photo\PhotoStorage;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/**
 * POST /api/photos and GET /api/photos/{id} in frontend/src/api/contract.ts. Independent of the event sync:
 * neither the item nor the event that references the photo has to exist yet.
 */
final class PhotoController extends AbstractController
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly PhotoStorage $storage,
    ) {
    }

    #[Route('/api/photos', methods: ['POST'])]
    public function upload(Request $request, User $user): JsonResponse
    {
        $fields = $request->request;
        $id = $this->uuid($fields->get('id'), 'id');
        $timberItemId = $this->uuid($fields->get('timber_item_id'), 'timber_item_id');
        $takenAt = Timestamp::parse($fields->get('taken_at')) ?? throw new BadRequestHttpException('taken_at must be an ISO 8601 timestamp.');
        $file = $request->files->get('file');

        // Over post_max_size PHP drops the whole body, so no field and no file arrive.
        if (!$file && $request->server->getInt('CONTENT_LENGTH') > ini_parse_quantity(ini_get('post_max_size') ?: '0')) {
            throw new HttpException(413, 'The upload exceeds post_max_size.');
        }
        if (!$file instanceof UploadedFile) {
            throw new BadRequestHttpException('file is missing.');
        }

        // A repeated upload (retry after a lost response) changes nothing.
        if ($this->em->find(Photo::class, $id)) {
            return $this->json(['id' => $id->toRfc4122()]);
        }

        if (\in_array($file->getError(), [\UPLOAD_ERR_INI_SIZE, \UPLOAD_ERR_FORM_SIZE], true) || $file->getSize() > PhotoStorage::MAX_BYTES) {
            throw new HttpException(413, 'A photo may be 10 MB at most.');
        }
        if (!$file->isValid()) {
            throw new BadRequestHttpException('The file could not be uploaded.');
        }
        if (!$this->storage->isJpeg($file->getPathname())) {
            throw new HttpException(415, 'The file is not a JPEG.');
        }

        $this->storage->store($id, $file->getPathname());
        try {
            $this->em->persist(new Photo($id, $timberItemId, $user, $file->getSize(), hash_file('sha256', $file->getPathname()), $takenAt));
            $this->em->flush();
        } catch (UniqueConstraintViolationException) {
            // Two uploads of the same id at once: the other one won, the file is identical.
        }

        return $this->json(['id' => $id->toRfc4122()], Response::HTTP_CREATED);
    }

    #[Route('/api/photos/{id}', requirements: ['id' => '[0-9a-fA-F-]{36}'], methods: ['GET'])]
    public function show(string $id): BinaryFileResponse
    {
        $file = Uuid::isValid($id) ? $this->storage->path(Uuid::fromString($id)) : null;
        if (!$file || !is_file($file)) {
            // Also while only the event has arrived and the upload is still on its way.
            throw new NotFoundHttpException('Unknown photo.');
        }

        $response = (new BinaryFileResponse($file, contentDisposition: ResponseHeaderBag::DISPOSITION_INLINE, autoEtag: true))
            ->setPrivate()
            ->setMaxAge(31536000)
            ->setImmutable();
        // Only JPEGs are stored, but the check is on the first bytes: the browser must not guess anything else.
        $response->headers->set('Content-Type', 'image/jpeg');
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        return $response;
    }

    private function uuid(mixed $value, string $field): Uuid
    {
        return \is_string($value) && Uuid::isValid($value) ? Uuid::fromString($value) : throw new BadRequestHttpException($field.' must be a UUID.');
    }
}
