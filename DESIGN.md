# BoulderO — Designrichtlinien

## Charakter

Ruhig, klar und sportlich. Die Oberfläche setzt auf Struktur, Weißraum und präzise Kontraste statt auf dekorative Effekte. Farbverläufe werden nicht dekorativ eingesetzt; die einzige Ausnahme ist die Kartenansicht einer Halle, in der ein vorhandenes Bild weich in die Inhaltsfläche übergeht. Abgerundete Ecken werden nur dort verwendet, wo sie Inhalt gruppieren oder eine Berührungsebene markieren.

## Farben

| Token | Wert | Einsatz |
| --- | --- | --- |
| `--ash-grey` | `#B4B8AB` | dezente Linien, ruhige Sekundärflächen |
| `--deep-space-blue` | `#153243` | primäre Textfarbe, Navigation, dunkle Flächen |
| `--yale-blue` | `#284B63` | Interaktion, Links, aktive Elemente |
| `--ivory` | `#F4F9E9` | helle Akzentfläche, positive Auswahl |
| `--soft-linen` | `#EEF0EB` | Seitenhintergrund, neutrale Flächen |

Besucht wird zusätzlich durch ein Häkchen gekennzeichnet — nicht nur durch Grün. Das ist barriereärmer als eine reine Rot-Grün-Codierung.

## Typografie

System-Sans-Serif: `Inter, Avenir Next, Helvetica Neue, Arial, sans-serif`.

- Anzeige: 32–40 px, Gewicht 650–700, enger Lauf
- Abschnittstitel: 17–20 px, Gewicht 650
- Lauftext: 14–16 px, Gewicht 400–500
- Metadaten: 12–13 px, Gewicht 550, leicht gespationiert

## Icons

Alle Produkt-Icons stammen aus [Tabler Icons](https://tablericons.com/) über `@tabler/icons-react`. Standard ist die Outline-Variante mit `stroke={1.8}`; die Größen sind 18 px für Textaktionen, 20 px für Navigation und 22–24 px für hervorgehobene Elemente. Eigene SVGs oder gemischte Icon-Sets werden nicht verwendet.

## Form und Abstand

- 4-px-Abstandsraster
- Standard-Innenabstand: 16 oder 20 px
- Karten und Bottom Sheets: 12 px Radius
- Buttons und Inputs: 8 px Radius
- Keine Pillen als Standardcontainer; Pillen ausschließlich für kleine Filter oder Status
- Dünne Linien: `rgba(21, 50, 67, 0.12)`

## Wiederverwendbare Bausteine

Gestaltungswerte liegen als CSS-Variablen vor (`--space-*`, `--radius-*`, Farb-Tokens). Neue Oberflächen verwenden diese Tokens statt direkter Pixel- und Farbwerte. Wiederkehrende Elemente werden über gemeinsame Klassen gebaut:

- `.ui-icon-button`: quadratische Icon-Aktion mit Rahmen
- `.filter-chip`: kleine, optionale Filterauswahl
- `.eyebrow`: Metadaten-Label in Versalien
- `.visit-button`: primäre, vollbreite Aktion
- `.section-heading`: Überschrift mit Sekundäraktion
- `.form-field`: beschriftetes Eingabefeld für Formulare
- `.photo-picker`: dezente, Datei-basierte Medienaktion
- `.journal-composer`: fokussierter Dialog zum Erstellen privater Einträge
- `.chosen-spot` / `.choose-spot`: Auswahl einer Halle über die Karte statt über lange Listen
- `.search-results` und `.filter-menu`: temporäre Karten-Overlays für Suche und Filter
- `.journal-filters`: kompakte Filterleiste im Tagebuch
- `.badge-card`, `.people-list` und `.feed-list`: standardisierte Flächen für Fortschritt und soziale Inhalte

Bevor ein neuer Stil ergänzt wird, wird geprüft, ob einer dieser Bausteine oder ein vorhandenes Token den Fall bereits abdeckt.

## Überschriften

Über-Überschriften (Eyebrows) werden nicht als dekorative Einleitung verwendet. Überschriften stehen direkt für sich. Ein `.eyebrow` ist ausschließlich zulässig, wenn er eine eigenständige, relevante Metainformation vermittelt, etwa einen Status, eine Kategorie oder einen Zeitpunkt. Dialoge und Formulare verwenden grundsätzlich nur ihre Hauptüberschrift.

## Bildsprache

Die vorhandenen Bergbilder tragen die emotionale Seite der Anwendung und werden sparsam auf Einstiegs- und Profilflächen eingesetzt. Produktfunktionen, insbesondere Karte und Besuchsstatus, bleiben bildarm und fokussiert.

## Privatsphäre

Sichtbarkeit wird als klarer Text statt nur über ein Symbol ausgewiesen: Privat, Freunde, Follower oder Öffentlich. Diese Auswahl gehört direkt zum Tagebucheintrag und gilt ebenfalls für seine Fotos. Die soziale Ansicht zeigt keine privaten Inhalte.
