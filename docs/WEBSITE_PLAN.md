# BoulderO Website: Umsetzungsplan

Stand: 22. August 2026

## Zielbild

Eine schnelle, eigenstandige BoulderO-Website unter `https://www.bouldero.de`. Die bestehende App bleibt unverandert unter `https://bouldero.de`, die Entwicklungsumgebung unter `https://dev.bouldero.de`.

Die Website wird statisch und ohne Laufzeit-Backend gebaut. "Headless" bedeutet in der ersten Version: Inhalte liegen lokal als HTML beziehungsweise strukturierte Build-Daten vor; es gibt kein CMS, keine Datenbank und keine Verbindung zur BoulderO-API. Falls spater redaktionelle Pflege durch mehrere Personen notwendig wird, kann ein Headless-CMS als getrennte zweite Phase folgen.

## Technische Entscheidung

- Eigener Quellordner `website/` im vorhandenen Repository
- Schlanker statischer Build mit lokal eingebundenem CSS und moglichst ohne Client-JavaScript
- Eigenes minimales Nginx-Image `ghcr.io/hubertoink/bouldero-site:latest`
- Separater Mittwald-Container-Stack im Projekt `BoulderO` (`p-bjne4n`)
- Bestehender, TLS-aktiver Virtualhost `www.bouldero.de` wird nach Abnahme von der Mittwald-Standardseite auf den Website-Container umgestellt
- Keine Anderung am bestehenden Container-Stack oder an `bouldero.de`

Der Website-Container hat keine Laufzeit-Abhangigkeit zu App, API oder Datenbank und kann unabhangig ausgerollt und zuruckgesetzt werden.

## Inhalt und Seitenstruktur

1. **Hero:** BoulderO als klare Hauptuberschrift, kurzer Nutzen und primare Aktion "App offnen" zu `https://bouldero.de`.
2. **Produkt:** Hallen entdecken, Besuche festhalten und Bouldertermine planen. Die Kartenansicht zeigt das Produkt direkt im ersten Viewport.
3. **Fortschritt:** Tagebuch, besuchte Hallen und personliche Meilensteine.
4. **Community:** Gemeinsame Planung und Teilen mit kontrollierter Sichtbarkeit. Keine echten Community-Inhalte auf der Website.
5. **Privatsphare:** Klarer Hinweis auf die Sichtbarkeiten Privat, Freunde, Follower und BoulderO Community.
6. **Abschlussaktion:** Erneuter Link zur App.
7. **Footer:** Impressum und Datenschutz als eigene statische Seiten.

Vorgesehene Routen:

- `/` - Website
- `/datenschutz/` - Datenschutzerklarung fur die Website
- `/impressum/` - Impressum

## Gestaltung

Die Website ubernimmt die vorhandenen BoulderO-Tokens aus `DESIGN.md`: Deep Space Blue, Yale Blue, Ivory, Soft Linen und die bestehende Logo-Familie. Alle Schriften und Bilder werden lokal ausgeliefert. Die Website bleibt ruhig, sportlich und produktnah; keine dekorativen Farbverlaufe, keine verschachtelten Karten und keine generischen Stock-Sektionen.

Vorbereitete, offentlich unkritische Screenshots:

- `docs/website-assets/01-welcome-desktop.png`
- `docs/website-assets/02-map-desktop.png`
- `docs/website-assets/03-map-mobile.png`

Die Kartenaufnahmen wurden ausgeloggt auf `localhost:8090` erzeugt. Die sichtbare OpenStreetMap-Attribution muss beim Zuschneiden erhalten bleiben. Feed- und Profilaufnahmen werden nicht verwendet, da lokale Demo-Daten wie Personenfotos oder Testhallen enthalten sein konnen.

Vor Veroffentlichung ist die Herkunft beziehungsweise Lizenz der vorhandenen Pexels-Bergbilder zu dokumentieren. Bilder werden fur die Auslieferung als AVIF/WebP optimiert; PNG bleibt nur als Fallback oder fur UI-Screenshots.

## Datenschutz-Baseline

Die erste Version benotigt keinen Consent-Banner, solange die folgenden Grenzen eingehalten werden:

- keine Cookies und kein `localStorage`
- kein Analytics, Tag Manager, Tracking-Pixel oder Session Recording
- keine externen Fonts, Skripte, CDNs, Karten-Tiles, Videos oder Social-Media-Embeds
- kein Kontaktformular; Kontakt zunachst nur als normaler `mailto:`-Link
- keine Verbindung zur BoulderO-API und keine Verarbeitung von App-Kontodaten
- nur lokale Bilder und Produkt-Screenshots ohne echte Nutzerinhalte
- Datenschutzerklarung nennt Mittwald-Hosting, technisch notwendige Server-Logs, Zweck, Rechtsgrundlage und Loschfrist
- Impressum und Datenschutz sind von jeder Seite erreichbar

Technische Schutzvorgaben:

- Content Security Policy mit `default-src 'self'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- restriktive `Permissions-Policy`
- HTTPS-only, HSTS nach erfolgreichem Erstdeployment
- keine Inline-Drittskripte

Eine rechtliche Endprufung der Texte bleibt vor Veroffentlichung sinnvoll.

## Sicherheitsaktion vor dem Deployment

Die Mittwald-CLI kann bei einer detaillierten Stack-Abfrage Umgebungswerte im Klartext ausgeben. Da eine solche Ausgabe in dieser Vorbereitung erzeugt wurde, sollten vor dem Website-Launch mindestens die betroffenen Produktions- und Staging-Geheimnisse rotiert werden:

- Datenbankpassworter
- Auth-Secrets
- SMTP-Passwort
- Superadmin-Zugang
- VAPID-Schlusselpaar

Die Werte durfen nicht in Tickets, Screenshots, Chat-Nachrichten, Git oder Deployment-Dokumentation ubernommen werden. Die temporare lokale CLI-Ausgabedatei wurde entfernt.

## Umsetzung in Phasen

### Phase 1: Inhalt und statischer Build

- Ordner `website/` mit semantischem HTML, CSS, lokalen Assets und Rechtstexten anlegen
- Texte auf die drei Kernversprechen reduzieren
- Screenshots zuschneiden und optimieren
- SEO-Grundlagen: Titel, Description, Canonical, Open-Graph-Bild, `robots.txt`, `sitemap.xml`

### Phase 2: Qualitat

- Responsive-Prufung bei 390x844, 768x1024, 1440x900 und 1920x1080
- Tastaturbedienung, Fokuszustande, Kontraste, Alternativtexte und reduzierte Bewegung prufen
- kontrollieren, dass kein Text uberlappt und der nachste Abschnitt im ersten Viewport angedeutet bleibt
- Netzwerkprufung: keine Requests an Drittanbieter
- Storage-Prufung: keine Cookies, kein Local Storage
- Links zu App, Impressum und Datenschutz testen
- Lighthouse beziehungsweise vergleichbare Checks fur Performance, Accessibility, Best Practices und SEO

### Phase 3: Mittwald

1. Secrets rotieren und App-Funktion kurz gegenprufen.
2. GitHub Actions baut und veroffentlicht `ghcr.io/hubertoink/bouldero-site:latest`.
3. Separaten Stack aus `compose.website.mittwald.yaml` im Projekt `p-bjne4n` deployen.
4. Die Site zunachst uber das Containerziel testen.
5. Bestehenden Virtualhost `www.bouldero.de` mit `mw domain virtualhost update <virtualhost-id> --path-to-container /:<container-id>:80/tcp` auf den Website-Container umstellen.
6. TLS, Canonical URL, Security Headers und alle Links in Produktion prufen.
7. Erst danach Caches aktivieren und den Build als freigegebene Version markieren.

Der bestehende Root-Virtualhost `bouldero.de` bleibt dabei auf dem BoulderO-Webcontainer. Ein Rollback betrifft nur `www.bouldero.de`: Virtualhost auf die vorherige Website-Version beziehungsweise die Mittwald-Standardseite zuruckstellen.

## Abnahmekriterien

- `www.bouldero.de` zeigt die Website, `bouldero.de` weiterhin die App
- keine Cookies und keine Drittanbieter-Netzwerkaufrufe
- keine echten Nutzer-, Feed-, Nachrichten- oder Profildaten in Website-Assets
- Impressum und Datenschutz funktionieren ohne JavaScript
- alle primaren Aktionen fuhren korrekt zur App
- Layout funktioniert ab 320 px Breite ohne Uberlappungen
- OpenStreetMap- und Bildlizenzen sind dokumentiert
- Static-Site-Deployment ist vom App-Stack unabhangig zuruckrollbar
