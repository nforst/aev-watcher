# aev-watcher

Überwacht die öffentliche Anfragenliste von
[app-entwickler-verzeichnis.de](https://app-entwickler-verzeichnis.de/anfragen-app-programmierung)
und schickt bei jeder neuen Projektanfrage eine WhatsApp-Nachricht.

**Kein zweiter Dienst nötig** – der WhatsApp-Client steckt über
[Baileys](https://github.com/WhiskeySockets/Baileys) direkt in dieser App. Einmal
per QR-Code koppeln, danach läuft alles in diesem einen Container.

Node.js 20+.

## Funktionsweise

1. Die Listenseite wird abgerufen (kein Login nötig, `robots.txt` erlaubt den Zugriff).
2. Jede Tabellenzeile wird geparst: ID, Eingangsdatum, Titel, Teaser, Anfragetyp,
   Betriebssysteme, Budget, Frist und Detail-URL.
3. Bereits gemeldete IDs stehen in der State-Datei. Alles, was dort nicht steht,
   ist neu und wird gemeldet.
4. Eine Anfrage wird **erst nach erfolgreichem Versand** als gesehen markiert –
   bricht die Verbindung weg, geht die Nachricht im nächsten Durchlauf raus.

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

Es gibt **keine Pflichtvariablen**. Ohne jede Konfiguration gehen die Nachrichten
an dein eigenes WhatsApp-Konto. Siehe [`.env.example`](.env.example).

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `WHATSAPP_TO` | `self` | `self` = an dich selbst; sonst Nummer international (`+4915112345678`) oder Gruppen-ID (`...@g.us`) |
| `STATE_FILE` | `./data/state.json` | gemeldete Anfragen; auf persistentes Volume legen |
| `WA_AUTH_DIR` | `./data/wa-auth` | WhatsApp-Kopplung; auf persistentes Volume legen |
| `INTERVAL_SECONDS` | `300` | Prüfintervall, Minimum 30 |
| `MAX_MESSAGES_PER_RUN` | `10` | Obergrenze pro Lauf, der Rest folgt im nächsten |
| `NOTIFY_ON_FIRST_RUN` | `false` | beim ersten Lauf über alle gelisteten Anfragen melden |

## Kommandos

```bash
node src/index.js                 # Dienst: verbinden, Verbindung halten, im Intervall prüfen
node src/index.js --login         # nur koppeln: QR-Code anzeigen und Sitzung speichern
node src/index.js --once          # einmalig prüfen, senden, beenden
node src/index.js --dry-run       # nur prüfen und Nachrichten ausgeben, ohne WhatsApp
node src/index.js --test-message  # Testnachricht senden
node src/index.js --logout        # gespeicherte Sitzung löschen (danach neu koppeln)
npm test                          # Parser-Tests gegen ein gespeichertes Seiten-Snapshot
```

`--dry-run` baut gar keine WhatsApp-Verbindung auf und eignet sich zum schnellen
Prüfen, ob der Parser noch zur Seitenstruktur passt. `--once` verbindet sich nur
dann, wenn es tatsächlich etwas zu senden gibt.

## Erste Einrichtung

```bash
npm install
node src/index.js --login     # QR-Code mit dem Handy scannen
node src/index.js --test-message
node src/index.js             # Dienst starten
```

Koppeln geht wie bei WhatsApp Web: **WhatsApp auf dem Handy → Einstellungen →
Verknüpfte Geräte → Gerät verknüpfen**, dann den QR-Code im Terminal scannen.
Die Sitzung liegt danach in `WA_AUTH_DIR` und bleibt gültig, bis du das Gerät im
Handy wieder trennst.

## Deployment auf Coolify

Repo als **Docker Compose**- oder **Dockerfile**-Anwendung anlegen und ein
persistentes Volume auf `/app/data` legen. Ohne dieses Volume ist nach jedem
Deploy die Kopplung weg und du musst neu scannen.

Der Container ist ein **Dauerläufer**, kein Scheduler-Job: er hält die
WhatsApp-Verbindung offen und prüft selbst alle `INTERVAL_SECONDS`. Ein
Coolify Scheduled Task ist damit nicht nötig – und wäre hier auch unpraktisch,
weil jeder Lauf die WhatsApp-Sitzung neu aufbauen müsste.

**Koppeln nach dem ersten Deploy:**

1. Anwendung starten und die Container-Logs in Coolify öffnen.
2. Dort erscheint der QR-Code als ASCII-Grafik – mit dem Handy scannen.
3. Im Log erscheint `WhatsApp verbunden als ...`. Fertig.

Wird nicht innerhalb von zwei Minuten gescannt, bricht der Start ab und Coolify
startet den Container neu – dann erscheint einfach ein frischer QR-Code.

## Grenzen

- Die Seite listet nur die **aktuell offenen** Anfragen (derzeit knapp 10). Wird eine
  Anfrage geschlossen, bevor ein Durchlauf sie gesehen hat, geht sie verloren –
  deshalb lieber ein Intervall von wenigen Minuten als von Stunden.
- Der Parser hängt am HTML der Listenseite. Ändert die Seite ihre Struktur, bricht
  der Lauf mit einer klaren Fehlermeldung ab, statt still nichts mehr zu melden.
  `npm test` und `--dry-run` zeigen das sofort.
- Baileys spricht das WhatsApp-Web-Protokoll mit deinem normalen Konto. Das ist für
  private Benachrichtigungen praktisch, ist aber kein offizieller WhatsApp-Zugang:
  Es entspricht nicht den WhatsApp-Geschäftsbedingungen, und WhatsApp kann solche
  Verbindungen jederzeit unterbinden. Für rein persönliche Benachrichtigungen in
  diesem Volumen ist das Risiko gering, aber es ist nicht null.
- Meldet WhatsApp die Sitzung ab (Gerät im Handy getrennt), beendet sich der Dienst
  mit einer Fehlermeldung. Dann `--logout` und neu koppeln.
