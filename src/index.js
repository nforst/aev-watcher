#!/usr/bin/env node
import { loadConfig } from './config.js';
import { formatMessage } from './message.js';
import { fetchAnfragen } from './scraper.js';
import { loadState, saveState } from './state.js';
import { LoggedOutError, WhatsAppClient } from './whatsapp.js';

const USAGE = `aev-watcher - benachrichtigt per WhatsApp ueber neue Anfragen
auf app-entwickler-verzeichnis.de

  node src/index.js                 Dienst starten: verbinden und alle INTERVAL_SECONDS pruefen
  node src/index.js --login         nur koppeln: QR-Code anzeigen und Sitzung speichern
  node src/index.js --once          einmalig pruefen, senden, beenden
  node src/index.js --dry-run       nur pruefen und Nachrichten ausgeben, ohne WhatsApp
  node src/index.js --test-message  Testnachricht senden
  node src/index.js --logout        gespeicherte Sitzung loeschen (danach neu koppeln)
  node src/index.js --help

Konfiguration erfolgt ueber Umgebungsvariablen, siehe .env.example.`;

function log(level, message, extra) {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const stream = level === 'ERROR' || level === 'WARN' ? console.error : console.log;
  if (extra === undefined) stream(line);
  else stream(line, extra);
}

/**
 * Ein Durchlauf: Liste holen, mit dem State abgleichen, neue Anfragen melden.
 *
 * @param {object} config
 * @param {{ getSender?: (() => Promise<(text: string) => Promise<unknown>>) | null }} options
 *   `getSender` fehlt -> Probelauf ohne Versand und ohne State-Aenderung. Die Funktion
 *   wird erst aufgerufen, wenn es wirklich etwas zu senden gibt, damit ein Lauf ohne
 *   neue Anfragen keine WhatsApp-Verbindung aufbaut.
 */
export async function runOnce(config, { getSender = null } = {}) {
  const dryRun = typeof getSender !== 'function';
  const items = await fetchAnfragen(config);
  const { state, isFirstRun } = await loadState(config.stateFile);
  const seen = new Set(state.seenIds);

  // Aelteste zuerst, damit bei einem Limit die aeltesten Anfragen zuerst rausgehen.
  const fresh = items.filter((item) => !seen.has(item.id)).sort((a, b) => a.id - b.id);

  state.lastRunAt = new Date().toISOString();

  // Erster Lauf: bestehende Anfragen nur aufnehmen, sonst gibt es sofort eine Flut alter Anfragen.
  if (isFirstRun && !config.notifyOnFirstRun) {
    state.firstRunAt = state.lastRunAt;
    state.seenIds = items.map((item) => item.id);
    if (!dryRun) await saveState(config.stateFile, state);
    log(
      'INFO',
      `Erster Lauf: ${items.length} bestehende Anfragen als bekannt gespeichert, keine Nachricht verschickt. Ab jetzt wird nur ueber neue Anfragen benachrichtigt.`,
    );
    return { total: items.length, fresh: 0, sent: 0, pending: 0, seeded: true };
  }

  if (fresh.length === 0) {
    if (!dryRun) await saveState(config.stateFile, state);
    log('INFO', `Keine neuen Anfragen (${items.length} offene Anfragen gelistet).`);
    return { total: items.length, fresh: 0, sent: 0, pending: 0, seeded: false };
  }

  const batch = fresh.slice(0, config.maxMessagesPerRun);
  const pending = fresh.length - batch.length;
  log('INFO', `${fresh.length} neue Anfrage(n) gefunden, sende ${batch.length}.`);

  let sent = 0;
  let sendError = null;
  const send = dryRun ? null : await getSender();

  for (const item of batch) {
    const message = formatMessage(item);

    if (dryRun) {
      console.log(`\n--- [dry-run] Anfrage ${item.id} ---\n${message}\n`);
      sent += 1;
      continue;
    }

    try {
      await send(message);
      // Erst nach erfolgreichem Versand als gesehen markieren - ein Fehlschlag
      // wird beim naechsten Lauf erneut versucht.
      state.seenIds.push(item.id);
      state.lastNotifiedAt = new Date().toISOString();
      sent += 1;
      log('INFO', `Benachrichtigt: ${item.id} "${item.title}"`);
    } catch (error) {
      sendError = error;
      log('ERROR', `Versand fuer Anfrage ${item.id} fehlgeschlagen: ${error.message}`);
      break;
    }
  }

  if (!dryRun) await saveState(config.stateFile, state);

  if (pending > 0) {
    log('INFO', `${pending} weitere neue Anfrage(n) folgen im naechsten Lauf (MAX_MESSAGES_PER_RUN).`);
  }
  if (sendError) {
    if (sendError instanceof LoggedOutError) throw sendError;
    // Ursache wurde oben schon protokolliert, hier nur noch die Bilanz des Laufs.
    throw new Error(`Lauf abgebrochen nach ${sent} von ${batch.length} Nachricht(en).`);
  }

  return { total: items.length, fresh: fresh.length, sent, pending, seeded: false };
}

async function connect(config) {
  const client = new WhatsAppClient(config, log);
  try {
    await client.connect();
  } catch (error) {
    // Ohne das Schliessen haelt der offene Socket den Prozess am Leben.
    await client.close();
    throw error;
  }
  return client;
}

function sender(client, config) {
  return (text) => client.sendText(config.whatsappTo, text);
}

/** Dauerbetrieb: einmal verbinden, Verbindung halten, im Intervall pruefen. */
async function serve(config) {
  const client = await connect(config);
  const getSender = async () => sender(client, config);

  let stopping = false;
  let wake = null;
  const stop = (signal) => {
    log('INFO', `${signal} empfangen, beende...`);
    stopping = true;
    wake?.();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log('INFO', `Dienst gestartet, Intervall ${config.intervalSeconds}s.`);

  try {
    while (!stopping) {
      try {
        await runOnce(config, { getSender });
      } catch (error) {
        // Abgemeldet heisst: ohne neuen QR-Code geht nichts mehr.
        if (error instanceof LoggedOutError) throw error;
        // Sonst im Dauerbetrieb nie hart abbrechen - der naechste Lauf versucht es erneut.
        log('ERROR', error.message);
      }
      if (stopping) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, config.intervalSeconds * 1000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  } finally {
    await client.close();
    log('INFO', 'Dienst beendet.');
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const config = loadConfig();

  if (args.has('--help') || args.has('-h')) {
    console.log(USAGE);
    return;
  }

  if (args.has('--dry-run')) {
    await runOnce(config);
    return;
  }

  if (args.has('--logout')) {
    await new WhatsAppClient(config, log).resetAuth();
    return;
  }

  if (args.has('--login')) {
    const client = await connect(config);
    log('INFO', 'Kopplung gespeichert. Der Dienst kann jetzt gestartet werden.');
    await client.close();
    return;
  }

  if (args.has('--test-message')) {
    const client = await connect(config);
    try {
      const { jid } = await client.sendText(
        config.whatsappTo,
        'Testnachricht vom aev-watcher. Die Einrichtung funktioniert.',
      );
      log('INFO', `Testnachricht an ${jid} gesendet.`);
    } finally {
      await client.close();
    }
    return;
  }

  if (args.has('--once')) {
    // Die Verbindung wird erst aufgebaut, wenn es tatsaechlich etwas zu senden gibt.
    let client = null;
    try {
      await runOnce(config, {
        getSender: async () => {
          client = await connect(config);
          return sender(client, config);
        },
      });
    } finally {
      await client?.close();
    }
    return;
  }

  await serve(config);
}

main().catch((error) => {
  log('ERROR', error.message);
  process.exitCode = 1;
});
