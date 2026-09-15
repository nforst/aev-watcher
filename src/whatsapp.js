import { mkdir, rm } from 'node:fs/promises';

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from 'baileys';
import qrcode from 'qrcode-terminal';

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
// Frist fuer den Verbindungsaufbau. Sie laeuft ab dem letzten QR-Code neu,
// damit beim erstmaligen Koppeln genug Zeit zum Scannen bleibt.
const CONNECT_TIMEOUT_MS = 120000;

// Baileys erwartet einen pino-aehnlichen Logger. Wir wollen die interne
// Protokollflut nicht im Container-Log haben, daher ein stiller Stub.
const silentLogger = {
  level: 'silent',
  child: () => silentLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

/** Fehler, der eine erneute QR-Kopplung erfordert - Reconnect hilft hier nicht. */
export class LoggedOutError extends Error {
  constructor(authDir) {
    super(
      `WhatsApp-Sitzung ist abgemeldet. Auth-Ordner ${authDir} loeschen und mit "--login" neu koppeln.`,
    );
    this.name = 'LoggedOutError';
  }
}

/**
 * Haelt die Verbindung zu WhatsApp Web, verbindet bei Abbruch automatisch neu
 * und versendet Textnachrichten. Die Anmeldung erfolgt einmalig per QR-Code,
 * danach liegen die Zugangsdaten im Auth-Ordner.
 */
export class WhatsAppClient {
  #config;
  #log;
  #sock = null;
  #saveCreds = null;
  #ready = null;
  #resolveReady = null;
  #rejectReady = null;
  #reconnectAttempt = 0;
  #closed = false;
  #loggedOut = false;
  #isOpen = false;
  #lastQrAt = 0;

  constructor(config, log) {
    this.#config = config;
    this.#log = log;
  }

  /** JID des eigenen Kontos, z. B. "4915112345678@s.whatsapp.net". */
  get selfJid() {
    const id = this.#sock?.user?.id;
    if (!id) return null;
    // Baileys haengt eine Geraete-Kennung an ("...:12@s.whatsapp.net").
    return id.replace(/:\d+(?=@)/, '');
  }

  #resetReadyPromise() {
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    // Ein noch nicht erfuellter Promise darf den Prozess nicht mit einer
    // unhandled rejection abschiessen, wenn gerade niemand darauf wartet.
    this.#ready.catch(() => {});
  }

  /** Baut die Verbindung auf und wartet, bis sie nutzbar ist. */
  async connect() {
    this.#closed = false;
    await mkdir(this.#config.authDir, { recursive: true });
    this.#resetReadyPromise();
    await this.#open();

    // Die Frist darf nicht den #ready-Promise vergiften, sonst wuerde ein
    // spaeter geglueckter Reconnect nichts mehr senden koennen.
    await Promise.race([this.#ready, this.#connectDeadline()]);
    return this;
  }

  #connectDeadline() {
    return new Promise((_, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (this.#isOpen || this.#closed) {
          clearInterval(timer);
          return;
        }
        const waitingSince = Math.max(start, this.#lastQrAt);
        if (Date.now() - waitingSince > CONNECT_TIMEOUT_MS) {
          clearInterval(timer);
          reject(
            new Error(
              this.#lastQrAt > 0
                ? 'QR-Code wurde nicht gescannt - Verbindungsaufbau abgebrochen.'
                : 'Zeitueberschreitung beim Verbinden mit WhatsApp.',
            ),
          );
        }
      }, 1000);
      timer.unref();
    });
  }

  async #open() {
    const { state, saveCreds } = await useMultiFileAuthState(this.#config.authDir);
    const { version } = await fetchLatestBaileysVersion();
    this.#saveCreds = saveCreds;

    this.#sock = makeWASocket({
      version,
      auth: state,
      logger: silentLogger,
      browser: ['aev-watcher', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      // Nicht als "online" markieren, sonst stellt WhatsApp die Push-
      // Benachrichtigungen auf dem Handy zu.
      markOnlineOnConnect: false,
    });

    this.#sock.ev.on('creds.update', saveCreds);
    this.#sock.ev.on('connection.update', (update) => this.#onConnectionUpdate(update));
  }

  #onConnectionUpdate({ connection, lastDisconnect, qr }) {
    if (qr) {
      this.#lastQrAt = Date.now();
      this.#log(
        'INFO',
        'Zum Koppeln: WhatsApp auf dem Handy > Einstellungen > Verknuepfte Geraete > Geraet verknuepfen, dann diesen QR-Code scannen:',
      );
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      this.#reconnectAttempt = 0;
      this.#isOpen = true;
      this.#log('INFO', `WhatsApp verbunden als ${this.selfJid ?? 'unbekannt'}.`);
      this.#resolveReady?.(this);
      return;
    }

    if (connection === 'close') {
      this.#isOpen = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        this.#loggedOut = true;
        const error = new LoggedOutError(this.#config.authDir);
        this.#log('ERROR', error.message);
        this.#rejectReady?.(error);
        return;
      }

      if (this.#closed) return;

      this.#reconnectAttempt += 1;
      const delay = Math.min(RECONNECT_BASE_MS * this.#reconnectAttempt, RECONNECT_MAX_MS);
      this.#log(
        'WARN',
        `WhatsApp-Verbindung getrennt (Code ${statusCode ?? 'unbekannt'}), neuer Versuch in ${delay / 1000}s.`,
      );
      this.#resetReadyPromise();
      setTimeout(() => {
        if (!this.#closed) this.#open().catch((error) => this.#rejectReady?.(error));
      }, delay).unref();
    }
  }

  /**
   * Wandelt eine Nummer in eine WhatsApp-JID.
   * "self" bzw. leer -> eigenes Konto.
   */
  resolveJid(raw) {
    const value = String(raw ?? '').trim();

    if (!value || value.toLowerCase() === 'self') {
      const jid = this.selfJid;
      if (!jid) throw new Error('Eigene JID ist noch nicht bekannt - erst verbinden.');
      return jid;
    }
    if (/@g\.us$/i.test(value)) return value;
    if (/@(s\.whatsapp\.net|c\.us)$/i.test(value)) {
      return value.replace(/@c\.us$/i, '@s.whatsapp.net');
    }

    const digits = value.replace(/\D/g, '');
    if (digits.length < 8) {
      throw new Error(`WHATSAPP_TO "${raw}" sieht nicht nach einer gueltigen Nummer aus.`);
    }
    if (digits.startsWith('00')) return `${digits.slice(2)}@s.whatsapp.net`;
    if (value.startsWith('0')) {
      throw new Error(
        `WHATSAPP_TO "${raw}" hat keine Laendervorwahl. Bitte international angeben, z. B. +49151...`,
      );
    }
    return `${digits}@s.whatsapp.net`;
  }

  async sendText(to, text) {
    if (this.#loggedOut) throw new LoggedOutError(this.#config.authDir);
    await this.#ready;
    const jid = this.resolveJid(to);
    const result = await this.#sock.sendMessage(jid, { text });
    return { jid, messageId: result?.key?.id ?? null };
  }

  async close() {
    this.#closed = true;
    try {
      if (this.#saveCreds) await this.#saveCreds();
      this.#sock?.end(undefined);
    } catch {
      // Beim Beenden sind Fehler egal.
    }
  }

  /** Loescht die gespeicherte Sitzung, damit neu gekoppelt werden kann. */
  async resetAuth() {
    await this.close();
    await rm(this.#config.authDir, { recursive: true, force: true });
    this.#log('INFO', `Auth-Ordner ${this.#config.authDir} geloescht.`);
  }
}
