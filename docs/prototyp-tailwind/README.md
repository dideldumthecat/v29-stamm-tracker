# Prototyp als Tailwind-Vorlage

Statische Screens des Klick-Prototyps (runde Variante), mit Tailwind 4 neu aufgebaut.
Vorlage für die Vue-Komponenten, keine Logik.

## Dateien
- `app.css` – Tailwind-Einstieg: Farben, Schrift, eigene Hilfsklassen, Grundstile.
  Wird später zu `frontend/src/assets/main.css`.
- `build.css` – daraus generiertes CSS, nur damit sich die HTML-Dateien direkt im Browser öffnen lassen. Nicht bearbeiten.
- `01-start.html` … `08-dialoge.html` – je ein Screen.

## Eigene Bausteine in `app.css`
| Klasse / Variante | Zweck |
|---|---|
| `bg-ink`, `text-mute`, `border-line` … | eigene Farben; die Standardpalette (`red-500` usw.) ist abgeschaltet |
| `px-gutter`, `mx-gutter` | Seitenabstand 16px, im Querformat mindestens so breit wie die Aussparung (Notch) |
| `pb-safe-4`, `top-safe-3` | Abstand plus Bereich des Home-Indikators bzw. der Statusleiste |
| `h-screen-safe` | Start-Screen genau eine Bildschirmhöhe |
| `short:` / `shorter:` | gilt nur bei Bildschirmhöhe ≤ 760px bzw. ≤ 700px |

## Lesehilfe Tailwind
- `size-11` = Breite und Höhe 44px (1 Einheit = 4px). Werte in eckigen Klammern sind frei: `h-[52px]`.
- `text-[17px]` = Schriftgröße; `text-ink` = Farbe – gleiches Präfix, Tailwind erkennt den Unterschied am Wert.
- Zustände als Präfix: `active:`, `disabled:`, `focus-within:`, `aria-pressed:` (Attribut `aria-pressed="true"`).
- `group` + `group-aria-pressed:` = ein Kindelement reagiert auf den Zustand des Elternelements (Kästchen in der Checkbox-Taste).
- `*:min-w-0` = gilt für alle direkten Kinder.
- `opacity-40` / `opacity-50` = abgeschwächte führende Nullen.

## Von der Vorlage zur Vue-App
- Lange, wiederholte Klassenlisten (Taste, Feld, Primärknopf) sind Absicht: In Vue wird daraus je eine Komponente,
  die Klassen stehen dann nur noch einmal. Kein `@apply` als Ersatz für Komponenten.
- Kommentare in den HTML-Dateien zeigen Varianten (Fehlermeldungen, gesperrte/ungesperrte Zustände).

## Abweichungen vom Klick-Prototyp
- Weggelassen, weil nur für den Prototyp: Info-Knopf, Info-Hinweis, „Sync-Fehler simulieren“, Zurücksetzen.
- Weggelassen: Vollbild-Fotoansicht (laut V29 keine Vorschau in der App).
- Zur Ansicht zusätzlich eingeblendet: Zähler am Sync-Knopf, ausgewählte Kachel und Haken (03),
  nicht übertragener Balken (04), neuer Messwert und neues Foto (05), Fehlerzustand beim Sync (06).
- Hinweis (Toast) ohne Wischgeste – die kommt per JavaScript.
- Schatten des Hinweises vereinfacht auf `shadow-lg`.

## Neu erzeugen
`build.css` mit der Tailwind-Kommandozeile (Version 4) aus diesem Ordner heraus:
`tailwindcss -i app.css -o build.css`
