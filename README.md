# aev-watcher

Überwacht die öffentliche Anfragenliste von
[app-entwickler-verzeichnis.de](https://app-entwickler-verzeichnis.de/anfragen-app-programmierung)
und schickt bei jeder neuen Projektanfrage eine WhatsApp-Nachricht über ein selbst
gehostetes [OpenWA](https://github.com/rmyndharis/OpenWA)-Gateway.

Node.js 20+, keine Runtime-Dependencies.

## Funktionsweise

1. Die Listenseite wird abgerufen (kein Login nötig, `robots.txt` erlaubt den Zugriff).
2. Jede Tabellenzeile wird geparst: ID, Eingangsdatum, Titel, Teaser, Anfragetyp,
   Betriebssysteme, Budget, Frist und Detail-URL.
3. Bereits gemeldete IDs stehen in der State-Datei. Alles, was dort nicht steht,
   ist neu und wird gemeldet.
4. Eine Anfrage wird **erst nach erfolgreichem Versand** als gesehen markiert –
   fällt das Gateway aus, geht die Nachricht im nächsten Durchlauf raus.

**Erster Lauf:** Die zum Startzeitpunkt gelisteten Anfragen werden ohne
Benachrichtigung übernommen, damit es keine Flut alter Anfragen gibt. Mit
`NOTIFY_ON_FIRST_RUN=true` wird stattdessen über alles benachrichtigt.

## Beispielnachricht

```
*Neue Anfrage: Mobile Player*
19 AUG · Firmenanfrage
Budget: €12.000 · OS: iOS (iPhone/iPad), Android · Frist: 31 AUG

Ich suche eine erfahrene Flutter-Entwicklerin / einen erfahrenen Flutter-Entwickler
für die Umsetzung einer Android-App (Mobile Player für Fitness-Trainer)...

https://app-entwickler-verzeichnis.de/anfragen-app-programmierung/7959-Mobile+Player
```

## Konfiguration

Alles läuft über Umgebungsvariablen, siehe [`.env.example`](.env.example).

| Variable | Pflicht | Default | Bedeutung |
| --- | --- | --- | --- |
| `OPENWA_BASE_URL` | ja | – | Basis-URL der OpenWA-Instanz, ohne Slash am Ende |
| `OPENWA_API_KEY` | ja | – | API-Key aus dem OpenWA-Dashboard (`X-API-Key`) |
| `OPENWA_SESSION_ID` | ja | – | **UUID** der Session, nicht der Session-Name |
| `WHATSAPP_TO` | ja | – | Empfänger international, z. B. `+4915112345678`; `@c.us` wird ergänzt |
| `STATE_FILE` | nein | `./data/state.json` | muss auf einem persistenten Volume liegen |
| `INTERVAL_SECONDS` | nein | `300` | Intervall für `--watch`, Minimum 30 |
| `MAX_MESSAGES_PER_RUN` | nein | `10` | Obergrenze pro Lauf, der Rest folgt im nächsten |
| `NOTIFY_ON_FIRST_RUN` | nein | `false` | beim ersten Lauf über alle gelisteten Anfragen melden |

Die Session-UUID findest du im OpenWA-Dashboard bzw. über
`GET {OPENWA_BASE_URL}/api/sessions` mit deinem API-Key.

## Kommandos

```bash
node src/index.js                 # einmalig prüfen und beenden (für Cron/Scheduler)
node src/index.js --watch         # dauerhaft laufen, alle INTERVAL_SECONDS prüfen
node src/index.js --dry-run       # prüfen und Nachrichten nur ausgeben, nichts senden/speichern
node src/index.js --test-message  # Testnachricht senden, um die Konfiguration zu prüfen
npm test                          # Parser-Tests gegen ein gespeichertes Seiten-Snapshot
```

`--dry-run` braucht keine OpenWA-Zugangsdaten und eignet sich zum schnellen Prüfen,
ob der Parser noch zur Seitenstruktur passt.

## Deployment auf Coolify

Repo in Coolify als **Docker Compose**- oder **Dockerfile**-Anwendung anlegen, die
vier Pflicht-Variablen als Environment Variables setzen und ein persistentes Volume
auf `/app/data` legen. Ohne dieses Volume ist der State nach jedem Deploy weg und
der nächste Lauf startet wieder als Erstlauf.

**Variante A – Container prüft selbst (Standard, kein Scheduler nötig)**

Nichts weiter zu tun: das Image startet `node src/index.js --watch` und prüft alle
`INTERVAL_SECONDS`.

**Variante B – Coolify Scheduled Task**

Coolify führt geplante Tasks in dem *laufenden* Container aus, der Container muss
also am Leben bleiben. Dafür:

1. Container-Command auf `sleep infinity` setzen (in `docker-compose.yml` ist die
   Zeile dafür vorbereitet).
2. Scheduled Task anlegen:
   - Command: `node /app/src/index.js`
   - Frequency: z. B. `*/5 * * * *`

Nach dem ersten Deploy einmal `node /app/src/index.js --test-message` im Container
ausführen – kommt die Nachricht an, stimmen Gateway, Session und Nummer.

## Lokal ausprobieren

```bash
cd aev-watcher
node src/index.js --dry-run

set -a && source .env && set +a
node src/index.js --test-message
node src/index.js --watch
```

## Grenzen

- Die Seite listet nur die **aktuell offenen** Anfragen (derzeit knapp 10). Wird eine
  Anfrage geschlossen, bevor ein Durchlauf sie gesehen hat, geht sie verloren –
  deshalb lieber ein Intervall von wenigen Minuten als von Stunden.
- Der Parser hängt am HTML der Listenseite. Ändert die Seite ihre Struktur, bricht
  der Lauf mit einer klaren Fehlermeldung ab, statt still nichts mehr zu melden.
  `npm test` und `--dry-run` zeigen das sofort.
- OpenWA ist ein inoffizielles Gateway auf Basis eines normalen WhatsApp-Kontos.
  Das ist für private Benachrichtigungen praktisch, entspricht aber nicht den
  offiziellen WhatsApp-Business-Bedingungen.
