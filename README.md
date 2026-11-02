# V29 Stamm-Tracker

An offline-first web app for tracking around 1,300 oak logs – and the beams sawn from them – from the forest to their place in a building.

Built pro bono for **V29**, a collective of architects building a publicly funded residential house in Leipzig from their own low-grade oak ("Schwachholz"). Every log carries a numbered metal tag. Until now, the numbers lived on labels and in an Excel sheet. The Stamm-Tracker replaces that: people in the field capture each log's attributes on their phone, and the data is collected centrally for project management and the research attached to the project.

## How it works

**Capture app** (mobile-first Progressive Web App, installed on the phone's home screen)

1. Type the tag number on a large on-screen number pad – usable with gloves, no barcode scanning.
2. The app shows the log if it already exists, or offers to create it.
3. Record attributes: yes/no, choice, number, text, date, month, measurement series.
4. Split a log into beams. Beams inherit attributes from their log unless they have their own value.
5. Sync by hand once there is a connection: own changes go up, the current state of all logs comes down. The app also downloads the current state by itself when it opens and when it returns to the foreground (at most once a minute, silently, never uploading); the start screen shows when the data was last downloaded, the counter on the sync button shows what is still waiting for the upload.

Everything is stored on the device first. Out in the woods there is usually no network, so the app works fully offline – including looking up what is already known about a log.

**Administration** (desktop, planned): manage attributes, correct or void entries, manage users, evaluate and export data.

## Design decisions

- **Offline-first with manual upload.** Own entries (later with large photos) leave the phone only when someone taps the sync button – people should know when their data has left the phone. Only the download of the current state runs by itself, when the app opens or returns to the foreground. No timer, no background sync (unreliable on iOS).
- **Append-only event log.** Nothing is ever updated or deleted. Every change is an event; corrections and voids are new events. The current state of each log is a projection computed from the events and can be rebuilt at any time. On conflicting values, the one that reached the server last wins.
- **Attributes are configuration, not code.** Everything domain-specific – even the wood species – is an attribute V29 defines themselves. A new process step needs no deployment and no migration.
- **Client-generated IDs.** Every log and every event gets a UUID on the device, so re-sending after a failed sync is harmless (idempotent). The tag number is a label, not the key.
- **Personal invite codes instead of passwords.** Each person gets a code that signs them in for good; it can be revoked individually.
- **Same origin for app and API.** The built app and the Symfony API are served from one host – no CORS, plain session cookies.
- **Boring hosting.** Runs on standard shared hosting (Apache, PHP, MariaDB); no Node.js on the server.

```mermaid
flowchart LR
    subgraph Phone["Phone (offline-first)"]
        UI[Vue screens] --> Store[Pinia store<br/>snapshot + pending events]
        Store <--> IDB[(IndexedDB)]
    end
    subgraph Server["Shared hosting"]
        API[Symfony API /api] --> Events[(Event log<br/>append-only)]
        Events --> Proj[(Projections<br/>current state)]
    end
    Store -- "1. POST /api/sync<br/>own events" --> API
    Proj -- "2. GET /api/snapshot<br/>state of all logs" --> Store
```

## Tech stack

| Part | Technology |
|---|---|
| Capture app | Vue 3 (Composition API, `<script setup>`), TypeScript, Pinia, Vue Router, Tailwind CSS 4, vite-plugin-pwa, IndexedDB via `idb` |
| API | PHP 8.4, Symfony 8, Doctrine ORM and Migrations |
| Database | MariaDB 11.8 |
| Tests | Vitest, Vue Test Utils, Playwright, PHPUnit |
| Tooling | DDEV, ESLint, Prettier, PHP CS Fixer, GitHub Actions |

## Repository layout

```
.
├── backend/              Symfony JSON API under /api
│   ├── src/Controller/   session, snapshot and sync endpoints
│   ├── src/Projection/   computes current state from the event log
│   ├── src/Command/      users, attribute import, voiding, export, projection rebuild, test reset
│   ├── data/             attribute definitions (YAML) for the import
│   └── migrations/
├── frontend/             Vue capture app (Progressive Web App)
│   ├── src/api/          API contract (types), fixtures, real and fake client
│   ├── src/stores/       state and domain logic
│   ├── src/persistence/  IndexedDB storage
│   ├── src/views/        screens
│   └── e2e/              Playwright tests
├── docs/
│   ├── prototype/        clickable prototype from the design phase
│   └── prototype-static/ static Tailwind screens used as template for the Vue components
├── .ddev/                local development environment
└── .github/workflows/    deployment
```

The API contract lives in `frontend/src/api/contract.ts`. The JSON fixtures next to it serve both as mock data for the app and as expected results in the backend tests, so frontend and backend cannot drift apart unnoticed.

## Local development

Requirements: [DDEV](https://ddev.com) with a Docker provider (for example OrbStack). Node.js and PHP do not need to be installed on the host – every command runs inside the container.

```sh
ddev start
ddev composer install
ddev frontend install
ddev console doctrine:migrations:migrate -n
ddev console app:user:create "Name" --admin
ddev console app:attributes:import data/attributes.yaml
ddev frontend run dev        # Vite dev server, runs in the foreground
```

`data/attributes.yaml` holds the attributes agreed with V29; `data/attributes.example.yaml` documents every option of the format.

- App: https://v29-stamm-tracker.ddev.site:5173 (requests to `/api` are proxied to Symfony)
- API: https://v29-stamm-tracker.ddev.site/api/ping

The dev server uses a **fake API** with the fixtures by default, so UI work needs no backend data. To use the real backend there, create `frontend/.env.development.local` containing `VITE_API=` and restart Vite. The built app (`ddev frontend run build`, served at https://v29-stamm-tracker.ddev.site) always uses the real API – the way to try out capture as it will run live.

`app:user:create` prints a ready-to-send invite message with the address (from `DEFAULT_URI`), the personal code and install steps for iPhone and Android. The code is shown only once. A browser shows only the install steps; the sign-in form appears in the installed app (and, for local work, on the dev server and with the fake API).

### Commands

| Task | Command |
|---|---|
| Frontend unit tests | `ddev frontend run tests` (watch mode: `ddev frontend run test:unit`) |
| End-to-end tests | `ddev frontend run test:e2e` (builds the app with the fake API and serves it itself, no dev server needed) |
| Build incl. type check | `ddev frontend run build` |
| Lint / format frontend | `ddev frontend run lint` / `ddev frontend run format` |
| Backend tests | `ddev phpunit` |
| Format PHP | `ddev php-cs-fixer fix` |
| Symfony console (an argument containing a space needs double quoting, e.g. `"'Max Muster'"`, because DDEV drops the outer quotes before the command reaches the container) | `ddev console …` |
| Users | `app:user:create`, `app:user:list`, `app:user:revoke` |
| Void a stem or beam created by mistake or twice (it leaves the snapshot, its tag is free again; a stem only once its beams are voided; recorded under the only admin or `--user`; `--dry-run` shows the item and writes nothing; on IONOS: dry run first, then the real run) | `ddev console app:item:void 123` or `app:item:void 123-A [--dry-run] [--user Name]` |
| Undo a void, e.g. a beam the sawyer removed in the app by mistake: have the tag named, dry run, restore, then the sawyer syncs again (the beam returns to the snapshot and its stem is locked again). Appends `restored` events, nothing is deleted. Refused if the tag is taken by another item meanwhile (void that one first) or the stem of a beam is voided (restore the stem first); restoring a stem does not restore its beams, each beam is restored on its own. Same options as the void | `ddev console app:item:restore 123-A [--dry-run] [--user Name]` |
| Export all stems and beams (current state, without voided) to Excel; without a path `stamm-tracker-export-YYYY-MM-DD-HHMM.xlsx` (Berlin time) in the current directory, see [Excel export](#excel-export) | `ddev console app:export [path.xlsx]` |
| Attach photos to stems and beams from a CSV (`file,tag` or `file;tag`), see [Photos](#photos) | `ddev console app:photo:import photos.csv [--dry-run]` |
| Set one attribute on many stems, see [Setting a value for many stems](#setting-a-value-for-many-stems) | `ddev console app:attribute:set Länge "'4,10 m'" --range all [--overwrite] [--dry-run] [--user Name]` |
| Clear one attribute on many stems (voids its recordings, the events stay), see [Clearing a value for many stems](#clearing-a-value-for-many-stems) | `ddev console app:attribute:clear "'Größter Stammdurchmesser'" --range all [--dry-run] [--user Name]` |
| Rebuild projections from all events | `ddev console app:projections:rebuild` |
| Import attributes from YAML (path relative to `backend/`; creates and updates, never deletes) | `ddev console app:attributes:import data/attributes.yaml [--dry-run]` |
| Testing only: delete events and projections (users stay) | `ddev console app:reset [--attributes] [--force]` |

### Excel export

`app:export` writes one sheet with a row per stem or beam: tag (plaque format), type, stem, created, created by, last change, then one column per attribute in attribute order. Inactive attributes appear only if an item has a value for them. Voided items are left out. It reads the same projections as the snapshot, so the file shows what the apps show after a sync.

On IONOS, run it over SSH from the home directory and download the file with `scp`:

```sh
ssh <user>@<host>
cd ~
<PHP_BIN> <REMOTE_PATH>/bin/console app:export   # prints file name and row count
exit
scp <user>@<host>:<file name from the output> .
```

The file lands in the current directory, so run it from the home directory, not from `public/`: it holds all data and `public/` is served on the web. Delete it after downloading. Needed PHP extensions: `zip`, `dom`, `libxml`, `xmlreader`, `filter` (check with `php -m`).

### Photos

Photos are JPEGs, compressed on the device (4032 px long edge; quality 0.6 on Apple's encoder, i.e. every browser on iOS and Safari on the Mac, otherwise 0.85); the server stores them unchanged and rejects files over 10 MB. They live in `var/photos/` (outside `public/`, set another folder with `PHOTO_DIR`) and are served only by `GET /api/photos/{id}` to signed-in users. A photo is an ordinary value of the one photo attribute ("Fotos", a series): the id is synced as an event, the file is uploaded separately via `POST /api/photos`, in any order.

`app:photo:import` attaches existing photos to stems and beams. The CSV has the header `file,tag` or `file;tag` (the separator is taken from the header; quoted fields work as usual), file paths are relative to the CSV, the tag may have leading zeros. Rows with an unknown tag, a missing file, a non-JPEG or a file over 10 MB are skipped and listed at the end. Run `--dry-run` first.

- **Convert the originals only once** (Mac: `sips -Z 4032 -s format jpeg -s formatOptions 60`). Converting again gives different checksums, and the import treats the files as new photos: duplicates are detected by checksum per stem or beam.
- A second run with the same files adds nothing.
- The capture time comes from the EXIF date (`DateTimeOriginal`, read as Berlin time), otherwise from the file date. Needs the PHP extension `exif` (`php -m`).
- The photos are recorded under the only admin, or under the user given with `--user` (name or ID).

**On IONOS**

- Storage: `<REMOTE_PATH>/var/photos/`. The folder is created on the first photo (mode 0750, owner = SSH user, who is also the PHP user on shared hosting – confirm with the first upload). `var/` is excluded from the deploy, so photos survive it.
- The database dump of the on-demand backup does not contain photos; they need their own copy of `var/photos/`.
- After the deploy, add the attribute once with `app:attributes:import data/attributes.yaml` (not on the sawmill days).
- Upload limits of the web server: check with a temporary `public/boom.php` containing `<?php header('Content-Type: text/plain'); var_dump(ini_get('upload_max_filesize'), ini_get('post_max_size'));` (delete it afterwards), opened in the browser (the command line may have other values); see "Logs and php.ini (IONOS)".
- Import: copy the photos and `photos.csv` to a folder outside `public/` (e.g. `~/photo-import/`), then:

```sh
cd ~/photo-import
<PHP_BIN> <REMOTE_PATH>/bin/console app:photo:import photos.csv --dry-run
<PHP_BIN> <REMOTE_PATH>/bin/console app:photo:import photos.csv
```

### Setting a value for many stems

`app:attribute:set <attribute> <value> --range <range>` records one value on many stems as ordinary events, so it shows in the snapshot and in `app:export` at once. `--range` is required: `all`, a number (`119`), a range (`1-10`) or a list (`1-10,15,20-25`); leading zeros do not matter.

- The attribute is given by its exact name. Only inheritable attributes that are not a series qualify (so not "Notiz" or "Fotos"). Beams are never touched; they inherit from their stem.
- The value: for a choice the exact option text (`"4,10 m"`, otherwise the valid options are listed), for a number `34,5`, for a boolean `ja` or `nein`, for a month `2026-10`.
- Only stems without a value get one. A stem that already has a value is skipped, unless `--overwrite` is given and the value differs. A second run changes nothing.
- Numbers in the range without a stem are listed at the end. Voided stems are ignored.
- `--dry-run` shows the counts (set, skipped, not found); with `--overwrite` it also lists "number: old value → new value". Check any input first: nothing is written when the attribute, value or range is invalid.
- Recorded under the only admin, or under the user given with `--user` (name or ID).

```sh
ddev console app:attribute:set Länge "'4,10 m'" --range all --user Alexander --dry-run
ddev console app:attribute:set Länge "'4,10 m'" --range 1-130 --user Alexander
```

A value with a space is quoted twice for `ddev console`: DDEV removes the outer quotes before passing the arguments into the container, so without the inner quotes `4,10 m` would become two arguments ("Too many arguments"). Alternatively, run `ddev ssh`, change to `backend/` and call `php bin/console app:attribute:set Länge "4,10 m" …` with normal quoting.

On IONOS there is no DDEV, so normal single quoting is enough (from the home directory, the command also runs from there):

```sh
<PHP_BIN> <REMOTE_PATH>/bin/console app:attribute:set Länge "4,10 m" --range all --dry-run
<PHP_BIN> <REMOTE_PATH>/bin/console app:attribute:set Länge "4,10 m" --range all
```

### Clearing a value for many stems

`app:attribute:clear <attribute> --range <range>` empties an attribute on stems, for example when a value turned out to be wrong and the next person measures again. Nothing is deleted (T03): for every recording of the attribute on the stem it appends a `voided` event whose `reference_id` is that `attribute_recorded` event. The projection ignores a voided recording whatever the order of arrival, so the field is empty and editable again in the app after the next download, and `app:export` shows an empty cell. A `voided` event that references the item's `created` event still voids the whole item (`app:item:void`).

- `--range`, `--user` and `--dry-run` work as for `app:attribute:set`; the attribute is given by its exact name.
- All recordings are voided, not only the latest, otherwise an older value would resurface. A value recorded afterwards counts again.
- Stems only: a beam's own recordings stay; a beam that merely inherited the value no longer shows it. Series attributes (e.g. "Fotos") are refused.
- Output: `Cleared: n, skipped (no value): m, no stem found: k`. A second run clears nothing.

```sh
ddev console app:attribute:clear "'Größter Stammdurchmesser'" --range all --user Alexander --dry-run
ddev console app:attribute:clear "'Größter Stammdurchmesser'" --range all --user Alexander
```

On IONOS: take a backup first, then `--dry-run`, then the real run, as above (normal quoting, no DDEV).

### Starting a test over

`app:reset` deletes all events and projections (with `--attributes` also attributes and options); users stay signed in. It breaks the append-only event log on purpose and is for test data only. It always refuses in prod. Elsewhere it asks for confirmation; with `--no-interaction`, `--force` replaces the confirmation.

Locally, a database snapshot is quicker and also restores the data instead of only deleting it:

```sh
ddev snapshot --name before-test
ddev snapshot restore before-test
```

To start from a completely empty database (users included), recreate it, then create the admin again and take a snapshot to return to:

```sh
ddev console doctrine:database:drop --force
ddev console doctrine:database:create
ddev console doctrine:migrations:migrate -n
ddev console app:user:create "Name" --admin    # note the code, it is shown only once
ddev snapshot --name empty-with-admin
```

The import never deletes: a renamed attribute or option is created anew next to the old one. While the attribute file is still changing, restore the snapshot and import again.

After a reset, also clear the app's local data on every phone used for the test (delete the home screen app or the site data in the browser settings). Otherwise their pending events are uploaded again at the next sync.

The backend tests use a separate database. Create it once (and repeat the second command after new migrations):

```sh
ddev console --env=test doctrine:database:create
ddev console --env=test doctrine:migrations:migrate -n
```

### Testing on a phone

Service workers and the camera require HTTPS with a trusted certificate, so phones go through a Cloudflare tunnel:

```sh
brew install cloudflared                          # once
ddev frontend run build -- --mode share           # new service worker takes over immediately
ddev share --provider=cloudflared                 # open the printed address on the phone
```

After a new build, reload the page on the phone twice. Restarting `ddev share` yields a new address – a new origin, so local test data on the phone is gone.

### Testing the update prompt

Once the app is live, new versions reach phones only through the "Neue Version verfügbar" hint, so test it before every release that touches it. Use the regular build (`registerType: 'prompt'`), never the Vite dev server or `--mode share`: both skip the waiting state, so the hint never appears. Every build gets a new build time and therefore a new service worker – no code change is needed to produce an "update".

**Desktop (Chrome)**

1. `ddev frontend run build`, open https://v29-stamm-tracker.ddev.site (without `:5173`), sign in, capture one or two stems without syncing.
2. DevTools → Application → Service Workers: turn **"Update on reload" off** (otherwise Chrome skips the waiting state).
3. `ddev frontend run build` again, reload the page once.
4. Check:
   - The hint appears on the start screen only. On the capture form it does not; going back to start shows it.
   - The close button hides it.
   - "Aktualisieren" reloads; the help page shows the new build time.
   - Pending (unsynced) stems are still there.

**Phone**

1. `ddev frontend run build` (without `--mode share`), then `ddev share --provider=cloudflared`.
2. Open the address on the phone and add the app to the home screen.
3. Keep `ddev share` running (a restart means a new address and a new origin) and build again.
4. Close the app completely (swipe it away in the app switcher) and reopen it from the icon – the hint should appear.

The browser looks for a new service worker only when the app is opened or reloaded. An app left open in the background shows the hint only after it has been closed and reopened.

### Mirroring production locally

`ddev sync` copies the production database and photos into DDEV, for debugging with real data. It only reads on the server. Not to be confused with the sync button in the app, which uploads a phone's entries.

1. Put the access data in `backend/.env.local` (see `backend/.env.local.example`; never in the repository): `SYNC_SSH_HOST` (SSH alias or `user@host`), `SYNC_REMOTE_PATH` (app folder on the server) and `SYNC_PHP_BIN` (PHP 8.4 binary on IONOS).
2. `ddev sync` (options `--skip-db`, `--skip-files`). It takes a snapshot `pre-sync-<timestamp>` first, replaces the local database with `app:db:dump` from the server, runs pending migrations and mirrors `var/photos/` (local photos not on the server are deleted).
3. Go back to the earlier local state with `ddev snapshot restore pre-sync-<timestamp>` (database only; photos are not restored).
4. The live invite codes also work locally (the sync copies the hashes). A separate local user (`ddev console app:user:create`) is optional.

**With production data in DDEV, do not run `ddev share`:** the live invite codes would then be valid on a public address.

Backup by hand (the dump contains no photos, they are files in `var/photos/`):

```sh
ssh <host> "cd <path> && <php> bin/console app:db:dump" | gzip > backup-YYYY-MM-DD.sql.gz
```

### Debugging

`ddev xdebug on` and the VS Code launch configuration "Xdebug (DDEV)" (port 9003). Turn it off again with `ddev xdebug off`, it slows every request down.

## Deployment

Deployment runs as a GitHub Actions workflow (`.github/workflows/deploy.yaml`), started manually – every deploy runs migrations against the live database.

1. Install Composer dependencies without dev packages.
2. Build the frontend; the build copies the app into `backend/public/` next to `index.php`.
3. Upload `backend/` to the server via rsync over SSH. `.rsync-exclude` protects server-only files such as `.env.local` and `var/`.
4. Clear the cache and run migrations on the server.

On the server, `.htaccess` routes `/api/*` and `/admin/*` to Symfony, serves existing files directly and everything else to `index.html`.

**One-time setup**

- Server: create `backend/.env.local` from `backend/.env.local.example`.
- GitHub environment `IONOS` – secrets `SSH_HOST`, `SSH_USERNAME`, `DEPLOY_SSH_PRIVATE_KEY`, `KNOWN_HOST_KEY`, `REMOTE_PATH`; variable `PHP_BIN` (on IONOS, plain `php` is an ancient version, so the path to the PHP 8.4 binary has to be set explicitly).

### Logs and php.ini (IONOS)

- **Symfony log:** `<REMOTE_PATH>/var/log/prod-YYYY-MM-DD.log`, one file for everything, one file per day, the last 30 are kept, level info and above. It holds one line per `/api` request (from `RequestLogListener`; the router's own "Matched route" lines are left out) – method, path, status, duration, request and response size in bytes (`null` when unknown), user (ID and name), shortened user agent and app build (header `X-App-Build`) – one line per sync (received / new / known / rejected, rejected ones with reason), photo upload (ID, bytes, stored or rejected) and snapshot (number of timber items), and every error with its full context and stack trace, including uncaught exceptions in console commands (handled failures that only print `[ERROR]`, e.g. an unreadable CSV, are not logged). 404 and 405 (bots probing for `/wp-login.php`, `/.env`) are logged as `NOTICE`, not as errors. Requests outside `/api` (the app files) are not logged. The request line holds the path only, never the query string; Symfony's own error and 404/405 messages carry the full address including the query string. Never logged: IP addresses, invite codes, cookies, request and response bodies.
- **App diagnostics log:** `<REMOTE_PATH>/var/log/client-YYYY-MM-DD.log`, what the app reports about itself (`POST /api/diagnostics`, sent automatically, no button), one JSON object per line, one file per day, the last 30 are kept; these lines are not in `prod-*.log`. Each line is one entry the app recorded on the phone: uncaught errors, failed requests (status, duration, the first 500 characters of an answer that is not JSON), the result of every photo upload (bytes, attempt, `blob_source`: `fresh` = captured since the app started, `stored` = read back from device storage), and steps of a sync and of an update (found, waiting, "Aktualisieren" tapped, new version active). The fields: `kind`, `count` (repeats of the same message while unsent), `device_time` (phone clock), `entry_id`, `user_name`, `app_build` (the build that sent the report, from the header `X-App-Build`), `user_agent`, and the entry's context (`recorded_build`, `route`, `online`, `visible`, `status`, …). `recorded_build` is the build that recorded the entry on the phone; it differs from `app_build` when a newer build sends what an older one recorded. Never contained: attribute values, invite codes, photo contents, URLs with query or hash. Messages are cut at 1,000 characters, other texts at 500.
- **PHP errors before Symfony starts:** `<REMOTE_PATH>/var/log/php-errors.log`, set by `public/php.ini`. This file is **not rotated**; delete or truncate it now and then (`: > php-errors.log`).
- `public/php.ini` exists only on the server (ignored by git, kept by the deploy, blocked in `.htaccess` – `/php.ini` answers 403). For our IONOS contract a `php.ini` applies to its own directory only, not to subfolders ([IONOS: customizing PHP settings](https://www.ionos.com/help/hosting/using-php-for-web-projects/customizing-the-php-settings-using-the-phpini-file/)). The documentation does not say whether the file adds to or replaces the default settings, so the template repeats the upload limits. Create it once from the template; the `var/log` folder must exist for PHP to write there:

```sh
cd <REMOTE_PATH>
mkdir -p var/log
sed "s#<REMOTE_PATH>#$(pwd)#" php.ini.example > public/php.ini
```

- Read the logs:

```sh
cd <REMOTE_PATH>/var/log
tail -n 50 prod-$(date +%F).log
grep -h /api/photos prod-*.log
grep -h '"user_name":"Kerstin"' prod-$(date +%F).log
grep -hE "\.(ERROR|CRITICAL)" prod-*.log
tail -n 20 php-errors.log
# App diagnostics log
grep -h '"user_name":"Kerstin"' client-*.log
grep -h '"kind":"photo_upload"' client-$(date +%F).log
grep -h '"level_name":"ERROR"' client-*.log
```

**Check after the deploy** (nothing stays in the repo)

- Symfony log: `curl -s -X POST https://<host>/api/session -H 'Content-Type: application/json' -d '{"token":"test"}'` answers 401 and writes an `ERROR` line "Unknown or revoked invite link" and a request line (status 401) in `prod-<today>.log`. `curl https://<host>/api/ping` adds a request line (the app build is empty for `curl`).
- App diagnostics log: sign in with the app, open the help page, then switch the phone to flight mode, tap "Sync" and switch it back on; the failed sync shows up as a `"kind":"request_failed"` line (and "Sync failed") in `client-<today>.log` after a few seconds, with the user's name and the app build.
- Console: `<PHP_BIN> bin/console dbal:run-sql "SELECT * FROM missing_table"` throws, and the exception appears in the same file.
- `php.ini`: over SSH, create `public/boom.php` containing `<?php header('Content-Type: text/plain'); var_dump(ini_get('log_errors'), ini_get('error_log'), ini_get('upload_max_filesize'), ini_get('post_max_size')); trigger_error('php-ini-test', E_USER_WARNING);`, open `https://<host>/boom.php`: it shows `string(1) "1"`, the path to `php-errors.log` and the upload limits (`64M` each, as in the template), and `tail php-errors.log` shows the warning. Delete `public/boom.php` afterwards. If the values are wrong, `public/php.ini` is not read (check the name and the path).

## Conventions

- Code, comments, commit messages and documentation in English. Content defined by V29 (attribute names, options) and the user interface are German.
- Domain terms in code: log or beam = `timber_item`, attribute = `attribute`, option = `attribute_option`, tag = `tag`.
- Attribute names and options are content – never hard-coded.

## Author

[Alexander Summa](https://alexandersumma.de) – design engineer, responsible for concept, UX, design and development.
