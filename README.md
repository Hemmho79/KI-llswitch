# Ki-llSwitch Mehrspieler-Server

Ein Server, keine Abhängigkeiten, Node.js ab Version 18.

## Starten

    node server.js

Dann im Browser `http://127.0.0.1:8787` öffnen. Auf der Team-Auswahl erscheint der Knopf „Online gegen Menschen“.
Wird die HTML-Datei ohne diesen Server geöffnet (z. B. per Doppelklick), bleibt der Knopf gesperrt, und die Einzelspieler-Modi laufen weiter wie bisher.

Einstellungen (Umgebungsvariablen):

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | 8787 | Port |
| `HOST` | 127.0.0.1 | Adresse; hinter einem Proxy so lassen |
| `DATA_DIR` | `./data` | Hier landen die Räume (`rooms.json`, alle 30 s und beim Beenden) |
| `HTML` | `public/index.html` | Die Spieldatei |
| `TICK_MS` | 1000 | Länge einer Spielstunde in ms (nur zum Testen kleiner stellen) |

## Hinter einem Reverse Proxy (empfohlen, wegen HTTPS)

Der Server selbst spricht nur HTTP. WebSocket-Verbindungen laufen über `/ws`. Der Proxy muss das Upgrade durchreichen und den `Host`-Header erhalten (der Server vergleicht ihn mit dem Origin).

nginx:

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 120s;
    }

Wichtig: Den Server nicht ohne Proxy ins Internet stellen, solange `X-Forwarded-For` für die Begrenzung pro IP gelesen wird (ein Client könnte ihn selbst setzen).

## Systemd (Beispiel)

    [Service]
    ExecStart=/usr/bin/node /opt/ki-llswitch-server/server.js
    Environment=PORT=8787 DATA_DIR=/var/lib/ki-llswitch
    User=killswitch
    Restart=on-failure

## Wie der Server arbeitet

- Der Server hält den einzigen Spielstand pro Raum und rechnet jede Sekunde einen Tick. Räume ohne verbundene Person ruhen.
- Jede Person bekommt nur die Sicht ihrer Seite. Blau sieht von Rot nur Spuren aus überwachten Regionen, entdeckte Anlagen und die Kriegslage; Rot sieht von Blau nur, was Blau auch im Einzelspieler dem Gegner verrät (die Entscheidungen im Spiel).
- Beide Seiten können ein Mensch oder der Computer sein. Die Stärke gilt nur für den Computer.
- Trennt sich jemand, übernimmt nach 30 s der Computer die Seite; mit derselben Kennung (im Browser gespeichert) kommt die Person zurück. Die Seite bleibt 2 Minuten für sie reserviert.
- Wer in den ersten 2 Spielminuten (120 Ticks) einem Raum beitritt, bekommt einen frischen Start.
- Gesperrt im Online-Spiel: Pause, Tagesbonus, Neustart während einer laufenden Partie.
- Schutz: Größenlimit für Nachrichten, 25 Nachrichten/s je Verbindung, höchstens 12 Verbindungen je IP, höchstens 300 Räume, Origin-Prüfung, Befehls-Whitelist je Seite.

## Datenschutz (Entwurf, keine Rechtsberatung)

Gespeichert werden: gewählter Name, zufällige Kennung (auch im Browser), Spielstand des Raums; Räume ohne Spieler werden nach 30 Minuten aus dem Speicher entfernt, der Stand in `DATA_DIR` wird beim nächsten Speichern entsprechend überschrieben. Keine Konten, keine Werbung, keine Dritten. IP-Adressen sieht der Betreiber in den Zugriffsprotokollen des Proxys. Der Text im Spiel (Lobby, „Datenschutz beim Online-Spiel“) ist ein Entwurf. Der Betreiber ist verantwortlich und muss Text, Aufbewahrungsfristen und Angaben zum Betreiber an seine Lage anpassen (ggf. Datenschutzerklärung, Impressum, Auftragsverarbeitung mit dem Hoster prüfen). Das muss eine fachkundige Person beurteilen.

## Noch nicht enthalten

- Kein Passwortschutz und keine Konten. Wer den Raumcode kennt, kann beitreten.
- Keine Rangliste, kein Chat.
- Die YunoHost-Paketierung folgt separat.
