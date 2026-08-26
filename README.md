# BoulderO

BoulderO ist eine Web-App für Kletterhallen, Sessions und Boulder-Tagebücher. Das Projekt besteht aus einem React/Vite-Frontend, einer Express-API mit Auth.js sowie PostgreSQL/PostGIS.

## Lokal mit Docker starten

Voraussetzung: Docker Desktop läuft.

```bash
npm run build
docker compose up --build -d
```

Danach ist die App unter [http://localhost:8090](http://localhost:8090) erreichbar.

Die Responsive-Regressionen pruefen die Docker-Auslieferung in den Viewports 320x568, 375x667, 390x844, 844x390, 412x915 und 768x1024:

```bash
npx playwright install chromium
npm run test:responsive
```

Nützliche Befehle:

```bash
docker compose logs -f
docker compose down
docker compose up --build -d
```

Das Image liefert ausschließlich die fertigen statischen Dateien über Nginx aus. Der Entwicklungsserver und `node_modules` werden nicht in das Image übernommen.

Die Docker-Umgebung besteht aus drei Services: Web-App (Nginx), API (Express + Auth.js) und PostgreSQL mit PostGIS. Die API ist über `/api/health` hinter dem Webservice erreichbar. Der Browser kommuniziert nie direkt mit der Datenbank.

E-Mail-Konten benötigen `APP_ORIGIN`, SMTP-Zugangsdaten und einen sicheren `AUTH_SECRET` aus `.env`. Ausgangspunkt ist [.env.example](.env.example). Neue Mitglieder bestätigen ihre Adresse per Link; Passwort-Reset und Passwortwechsel im Profil verwenden denselben SMTP-Versand. Google-Anmeldung bleibt optional.

Für lokale Tests ist zusätzlich der Auth.js-Testmodus aktiv (`DEMO_MODE=true`). Er stellt drei getrennte Testprofile bereit: Mira Keller, Alex Winter und Lea Hofmann. Über „Anmelden“ kann zwischen ihnen gewechselt werden, um Folgen, gegenseitige Freunde und die Sichtbarkeit `Follower` beziehungsweise `Freunde` zu prüfen. Der Testmodus muss in Staging und Produktion auf `false` gesetzt werden.

## Bereitstellung per Docker

Die Anwendung ist für eine Docker-Compose-Umgebung vorbereitet und kann damit auch auf einem Server wie Mittwald getestet werden. Auf dem Zielsystem werden Docker Engine und das Compose-Plugin benötigt.

```bash
git clone https://github.com/Hubertoink/BoulderO.git
cd BoulderO
cp .env.example .env
# .env mit sicheren Produktionswerten ergänzen
docker compose up --build -d
```

Vor einer öffentlich erreichbaren Installation müssen mindestens `POSTGRES_PASSWORD`, `AUTH_SECRET`, `APP_ORIGIN`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` und `SMTP_FROM` sicher gesetzt sowie `DEMO_MODE=false` konfiguriert werden. Für Mittwald lautet die SMTP-Konfiguration `SMTP_HOST=mail.agenturserver.de`, `SMTP_PORT=465`, `SMTP_SECURE=true`; Benutzername und Passwort stammen aus dem eingerichteten Postausgang. Der Webservice lauscht standardmäßig auf Port `8090`; in einer Produktionsumgebung sollte davor ein TLS-fähiger Reverse Proxy eingesetzt werden.

Zum Aktualisieren der laufenden Installation:

```bash
git pull
npm run build
docker compose up --build -d
```

### Mittwald Container Stack

Für Mittwald wird die separate Datei [`compose.mittwald.yaml`](compose.mittwald.yaml) verwendet. Sie referenziert die beim Push nach `main` automatisch nach GitHub Container Registry veröffentlichten Images. Die Zugangswerte werden ausschließlich bei der Bereitstellung als Umgebungsvariablen gesetzt und nicht in Git gespeichert.

## Push-Benachrichtigungen

Die PWA kann Nachrichten, Freundschaftsaktivitäten, Beitragsreaktionen und Planungsänderungen als Web Push zustellen. Die Funktion bleibt standardmäßig deaktiviert. Einmalig lokal `npm run push:keys` ausführen und die drei ausgegebenen VAPID-Werte ausschließlich als Deployment-Variablen setzen. Anschließend `PUSH_NOTIFICATIONS_ENABLED=true` setzen. Private Schlüssel gehören niemals in Git. Nutzer:innen aktivieren Push anschließend bewusst unter Profil → Benachrichtigungen auf jedem Gerät separat.

```bash
AUTH_SECRET="..." POSTGRES_PASSWORD="..." \
  mw stack deploy -s <stack-id> -c compose.mittwald.yaml
```

Der Webservice wird anschließend über einen Mittwald-Virtualhost auf Port `80/tcp` veröffentlicht. Für reale Konten muss `DEMO_MODE=false` gelten. Die API erhält pro Umgebung eine eigene `APP_ORIGIN`-Variable, damit Bestätigungs- und Reset-Links korrekt zeigen: `https://bouldero.de` in Produktion und `https://dev.bouldero.de` in Staging. Der SMTP-Postausgang wird ebenfalls ausschließlich als Container-Umgebung konfiguriert.

Nach einem Host-Neustart können die Container unabhängig voneinander wieder anlaufen. Der Webservice löst seinen API-Upstream deshalb erst bei einer Anfrage über Docker-DNS auf. Wenn die API noch startet, liefert Nginx vorübergehend höchstens einen `502` für API-Anfragen; der Webcontainer beendet sich nicht und verbindet sich automatisch, sobald die API erreichbar ist. Alle drei Dienste verwenden außerdem `restart: unless-stopped`.

`main` veröffentlicht die Produktions-Tags `latest`; `dev` veröffentlicht getrennte Tags `dev`. Der GitHub-Workflow baut das Frontend vor jedem Image-Build frisch. Dadurch kann derselbe API- und Web-Quellstand getrennt nach Staging und Produktion ausgerollt werden.

Für die vorläufige Verwaltung kann zusätzlich ein passwortgeschütztes Superadmin-Konto aktiviert werden. Die Werte `SUPERADMIN_EMAIL` und `SUPERADMIN_PASSWORD` müssen ausschließlich in der Deployment-Umgebung gesetzt werden. Das Konto erhält Zugriff auf „Hallen verwalten“ und kann neue Hallen mit Adresse und Koordinaten anlegen; gewöhnliche Konten erhalten hierfür keine API-Berechtigung.

## Sichtbarkeit von Tagebüchern und Fotos

Beim Speichern und im Detail eines Tagebucheintrags kann dessen Sichtbarkeit gewählt werden: privat, Freunde (beidseitiges Folgen), Follower oder BoulderO Community. Community bedeutet: im Feed für alle angemeldeten BoulderO-Konten sichtbar — keine externe, frei im Web sichtbare Veröffentlichung. Fotos übernehmen automatisch dieselbe Regel und werden von der API nur für berechtigte Konten ausgeliefert. Eigentümerinnen und Eigentümer können einzelne Fotos jederzeit im Eintragsdetail entfernen.

Der Feed unterstützt Likes und Kommentare. Direktnachrichten sind bewusst auf gegenseitige Freunde beschränkt. Für zwei bebilderte Feed-Beiträge aus den lokalen Assets kann der Seeder nach dem Kopieren der Dateien in den API-Container ausgeführt werden; die laufende lokale Testumgebung enthält diese Beispiele bereits.

## Hallenimport

Die Datenbank ist die zentrale Quelle der Hallendaten. Es gibt keine Stammdaten-Datei, die beim Start erneut in die Datenbank geschrieben wird. Ein Deployment löscht oder ersetzt keine bestehenden Hallen, Besuche, Tagebucheinträge oder Bilder.

Superadmins exportieren Hallen als Excel-Datei aus „Hallen verwalten“, bearbeiten sie und laden sie anschließend dort wieder hoch. XLSX und CSV werden unterstützt. Für einen sicheren Rückimport muss die exportierte `id` unverändert bleiben: Sie aktualisiert genau diesen bestehenden Datensatz und erhält damit alle Nutzerverknüpfungen. Ohne `id` werden eine Quellen-ID, gleicher Name und ein Abstand von bis zu 150 Metern als mögliche Treffer vorgeschlagen.

Der Import zeigt vor dem Schreiben eine Vorschau. Jede Zeile kann angelegt, einer bestehenden Halle zugeordnet oder übersprungen werden. Fehlende Zeilen führen niemals zu einer Löschung oder Archivierung. Leere optionale Felder überschreiben keine bestehenden Werte; Bilder und der Archivstatus bleiben beim Import erhalten.

`Dockerfile` dient dem schnellen lokalen Test und verpackt den bereits erzeugten `dist`-Ordner. Für eine CI-Pipeline mit Zugriff auf npm gibt es zusätzlich `Dockerfile.ci`; dieses erzeugt den Web-Build vollständig innerhalb des Container-Builds:

```bash
docker build -f Dockerfile.ci -t bouldero:ci .
```

## Lasttest mit fiktiven Hallen

Für UI- und Ladezeittests können 1.000 klar gekennzeichnete, fiktive Hallen erzeugt werden. Etwa 150 liegen im Raum Mannheim, die übrigen verteilen sich über deutsche Städte. Der Befehl ist idempotent und aktualisiert bei Wiederholung dieselben Testdaten:

```bash
docker compose exec api node scripts/seed-test-spots.js 1000
```
