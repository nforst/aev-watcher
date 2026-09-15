#!/usr/bin/env node
import { loadConfig } from './config.js';
import { formatMessage, sendText } from './notify.js';
import { fetchAnfragen } from './scraper.js';
import { loadState, saveState } from './state.js';

const USAGE = `aev-watcher - benachrichtigt per WhatsApp ueber neue Anfragen
auf app-entwickler-verzeichnis.de

  node src/index.js                 einmalig pruefen und beenden (fuer Cron/Scheduler)
  node src/index.js --watch         dauerhaft laufen, alle INTERVAL_SECONDS pruefen
  node src/index.js --dry-run       pruefen und Nachrichten nur ausgeben, nichts senden/speichern
  node src/index.js --test-message  Testnachricht senden, um die OpenWA-Konfiguration zu pruefen
  node src/index.js --help

Konfiguration erfolgt ueber Umgebungsvariablen, siehe .env.example.`;

function log(level, message, extra) {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const stream = level === 'ERROR' ? console.error : console.log;
  if (extra === undefined) stream(line);
  else stream(line, extra);
}

/**
 * Ein Durchlauf: Liste holen, mit dem State abgleichen, neue Anfragen melden.
 * @returns {Promise<{ total: number, sent: number, pending: number, seeded: boolean }>}
 */
export async function runOnce(config, { dryRun = false } = {}) {
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
    return { total: items.length, sent: 0, pending: 0, seeded: true };
  }

  if (fresh.length === 0) {
    if (!dryRun) await saveState(config.stateFile, state);
    log('INFO', `Keine neuen Anfragen (${items.length} offene Anfragen gelistet).`);
    return { total: items.length, sent: 0, pending: 0, seeded: false };
  }

  const batch = fresh.slice(0, config.maxMessagesPerRun);
  const pending = fresh.length - batch.length;
  log('INFO', `${fresh.length} neue Anfrage(n) gefunden, sende ${batch.length}.`);

  let sent = 0;
  let sendError = null;

  for (const item of batch) {
    const message = formatMessage(item);

    if (dryRun) {
      console.log(`\n--- [dry-run] Anfrage ${item.id} ---\n${message}\n`);
      sent += 1;
      continue;
    }

    try {
      await sendText(config, message);
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
    // Ursache wurde oben schon protokolliert, hier nur noch die Bilanz des Laufs.
    throw new Error(`Lauf abgebrochen nach ${sent} von ${batch.length} Nachricht(en).`);
  }

  return { total: items.length, sent, pending, seeded: false };
}

async function watch(config) {
  let stopping = false;
  const stop = (signal) => {
    log('INFO', `${signal} empfangen, beende nach dem aktuellen Durchlauf.`);
    stopping = true;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log('INFO', `Watch-Modus gestartet, Intervall ${config.intervalSeconds}s.`);

  while (!stopping) {
    try {
      await runOnce(config);
    } catch (error) {
      // Im Dauerbetrieb nie hart abbrechen - der naechste Durchlauf versucht es erneut.
      log('ERROR', error.message);
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }

  log('INFO', 'Watcher beendet.');
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--help') || args.has('-h')) {
    console.log(USAGE);
    return;
  }

  const dryRun = args.has('--dry-run');
  const config = loadConfig({ requireNotifier: !dryRun });

  if (args.has('--test-message')) {
    await sendText(config, 'Testnachricht vom aev-watcher. Konfiguration funktioniert.');
    log('INFO', `Testnachricht an ${config.openwa.chatId} gesendet.`);
    return;
  }

  if (args.has('--watch')) {
    await watch(config);
    return;
  }

  await runOnce(config, { dryRun });
}

main().catch((error) => {
  log('ERROR', error.message);
  process.exitCode = 1;
});
