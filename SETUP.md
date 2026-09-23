# Setup-Plan – Grundgerüst aufsetzen

Einmalige Aufgabe. Nach erfolgreichem Setup kann diese Datei gelöscht werden. Projektkontext siehe `BRIEF.md`.

## Ausgangslage
- Repo-Root: `~/My Repositories/v29-stammbuch` – **noch kein Git**
- `spike/` – Scan-Prototyp (Vue + Vite + vite-plugin-mkcert), nur Referenz
- `project` – Symlink auf `~/Documents/MyProjects/V29/Stammbuch` (Drive-Backup), bereits in `.gitignore`
- `.gitignore` im Root existiert bereits

## Schritte

### 1. Git
- `git init -b main`, erster Commit mit dem Ist-Zustand, Tag `spike-v0`
- Prüfen, dass `project`, `node_modules/`, `dist/` nicht im Commit landen

### 2. Backend (Symfony)
- `backend/` via `composer create-project symfony/skeleton backend` (am besten über DDEV, siehe 3)
- Nur API: Doctrine ORM + Migrations, kein Twig-Frontend
- DB-Verbindung auf MariaDB

### 3. DDEV (Root)
- `.ddev/config.yaml`:
  - `name: v29-stammbuch` **explizit setzen** (nicht vom Ordnernamen ableiten)
  - `type: php`, `docroot: backend/public`
  - PHP- und MariaDB-Version passend zu IONOS wählen
- `.ddev/config.vite.yaml`:
  - `web_extra_exposed_ports`: Vite-Port 5173 (HTTPS nach außen)
  - `web_extra_daemons`: `npm run dev` im Ordner `frontend/`
- Kein Browsersync – Vite-HMR reicht

### 4. Frontend (Vue-PWA)
- **Frisch** anlegen: `npm create vue@latest frontend` mit TypeScript, Pinia, Router, Vitest
- `vite-plugin-pwa` ergänzen
- Den Spike **nicht** weiterverwenden: dessen `package.json` enthält versehentliche devDependencies (`install`, `npm`, `und`), `pinia` steht falsch unter devDependencies
- Scanner-Code aus `spike/src/domain/*Scanner.ts` übernehmen
- `vite.config.ts`:
  - `server.host: '0.0.0.0'`, `server.port: 5173`, `strictPort: true`
  - `server.origin` und `hmr` aus Env-Variable `DDEV_PRIMARY_URL`/`DDEV_HOSTNAME` ableiten – **keine hartcodierte URL** (Projektname kann sich ändern)
  - Proxy `/api` → Symfony im Container (`http://localhost`) → gleiche Origin, kein CORS, Cookies funktionieren
- Kein vite-plugin-mkcert mehr – HTTPS kommt von DDEV

### 5. CLAUDE.md
- Root-`CLAUDE.md`: Überblick, `@BRIEF.md`, wie man lokal startet (`ddev start`, URLs)
- `backend/CLAUDE.md`: Symfony-Konventionen, Event-Log-Regel (nur INSERT in `ereignis`, nie UPDATE)
- `frontend/CLAUDE.md`: Vue-Konventionen (`<script setup>`, TS, Pinia), Offline-Queue, manueller Sync
- `.claude/launch.json` um `frontend` ergänzen bzw. auf DDEV umstellen

### 6. Prüfen
- `ddev start` läuft, `https://v29-stammbuch.ddev.site` liefert Symfony
- Vite erreichbar unter `https://v29-stammbuch.ddev.site:5173`, HMR funktioniert
- `/api`-Request aus dem Frontend kommt beim Backend an
- Commit

## Später (nicht Teil dieses Setups)
- Handy-Tests: `ddev share` oder Staging hinter Basic Auth (DDEV-Zertifikat ist auf dem Handy nicht vertrauenswürdig)
- Prod-Build: SPA im Root, Symfony unter `/api` via `.htaccess` auf IONOS
- `spike/` löschen, sobald der MVP den Scan kann (bleibt über Tag `spike-v0` abrufbar)
- Lokale Sicherung dessen, was nicht im Git-Remote landet: `.env.local`, DB-Dumps (`ddev export-db`) in den `project/`-Ordner
