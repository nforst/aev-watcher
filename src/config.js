const DEFAULTS = {
  baseUrl: 'https://app-entwickler-verzeichnis.de',
  listPath: '/anfragen-app-programmierung',
  stateFile: './data/state.json',
  authDir: './data/wa-auth',
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
 * Konfiguration aus Umgebungsvariablen. Es gibt keine Pflichtvariablen:
 * ohne WHATSAPP_TO gehen die Nachrichten an das eigene Konto.
 */
export function loadConfig() {
  const env = process.env;
  const baseUrl = (env.AEV_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, '');

  return {
    baseUrl,
    listUrl: env.AEV_LIST_URL || `${baseUrl}${DEFAULTS.listPath}`,
    stateFile: env.STATE_FILE || DEFAULTS.stateFile,
    authDir: env.WA_AUTH_DIR || DEFAULTS.authDir,
    whatsappTo: env.WHATSAPP_TO || 'self',
    intervalSeconds: num(env.INTERVAL_SECONDS, DEFAULTS.intervalSeconds, { min: 30 }),
    maxMessagesPerRun: num(env.MAX_MESSAGES_PER_RUN, DEFAULTS.maxMessagesPerRun),
    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs, { min: 1000 }),
    userAgent: env.USER_AGENT || DEFAULTS.userAgent,
    notifyOnFirstRun: bool(env.NOTIFY_ON_FIRST_RUN, false),
  };
}
