const DEFAULTS = {
  baseUrl: 'https://app-entwickler-verzeichnis.de',
  listPath: '/anfragen-app-programmierung',
  stateFile: './data/state.json',
  intervalSeconds: 300,
  maxMessagesPerRun: 10,
  requestTimeoutMs: 20000,
  userAgent: 'aev-watcher/1.0 (+https://app-entwickler-verzeichnis.de lead notifier)',
};

function num(value, fallback, { min = 1 } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Ungueltiger Zahlenwert "${value}" (erwartet: Zahl >= ${min})`);
  }
  return parsed;
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(String(value).toLowerCase());
}

/**
 * Bringt eine Telefonnummer in das von OpenWA erwartete chatId-Format.
 * "+49 151 1234567" -> "491511234567@c.us"
 * Bereits fertige IDs ("...@c.us" / "...@g.us") werden unveraendert uebernommen.
 */
export function toChatId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('WHATSAPP_TO ist nicht gesetzt.');
  if (/@(c|g)\.us$/i.test(value)) return value;

  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) {
    throw new Error(`WHATSAPP_TO "${raw}" sieht nicht nach einer gueltigen Nummer aus.`);
  }
  if (digits.startsWith('00')) return `${digits.slice(2)}@c.us`;
  if (value.startsWith('0') && !value.startsWith('00')) {
    throw new Error(
      `WHATSAPP_TO "${raw}" hat keine Laendervorwahl. Bitte international angeben, z. B. +49151...`,
    );
  }
  return `${digits}@c.us`;
}

/**
 * @param {{ requireNotifier?: boolean }} options
 */
export function loadConfig({ requireNotifier = true } = {}) {
  const env = process.env;
  const baseUrl = (env.AEV_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, '');

  const config = {
    baseUrl,
    listUrl: env.AEV_LIST_URL || `${baseUrl}${DEFAULTS.listPath}`,
    stateFile: env.STATE_FILE || DEFAULTS.stateFile,
    intervalSeconds: num(env.INTERVAL_SECONDS, DEFAULTS.intervalSeconds, { min: 30 }),
    maxMessagesPerRun: num(env.MAX_MESSAGES_PER_RUN, DEFAULTS.maxMessagesPerRun),
    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs, { min: 1000 }),
    userAgent: env.USER_AGENT || DEFAULTS.userAgent,
    notifyOnFirstRun: bool(env.NOTIFY_ON_FIRST_RUN, false),
    openwa: {
      baseUrl: (env.OPENWA_BASE_URL || '').replace(/\/+$/, ''),
      apiKey: env.OPENWA_API_KEY || '',
      sessionId: env.OPENWA_SESSION_ID || '',
      chatId: '',
    },
  };

  if (requireNotifier) {
    const missing = ['OPENWA_BASE_URL', 'OPENWA_API_KEY', 'OPENWA_SESSION_ID', 'WHATSAPP_TO'].filter(
      (key) => !env[key],
    );
    if (missing.length > 0) {
      throw new Error(
        `Fehlende Konfiguration: ${missing.join(', ')}. Siehe .env.example.`,
      );
    }
    config.openwa.chatId = toChatId(env.WHATSAPP_TO);
  }

  return config;
}
