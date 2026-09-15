const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

export function decodeEntities(input) {
  return String(input ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name] ?? match);
}

function text(input) {
  return decodeEntities(String(input ?? '').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(row, regex, group = 1) {
  const match = row.match(regex);
  return match ? match[group] : null;
}

const MONTH_NAMES = {
  JAN: 'Januar',
  FEB: 'Februar',
  'MÄR': 'März',
  MRZ: 'März',
  APR: 'April',
  MAI: 'Mai',
  JUN: 'Juni',
  JUL: 'Juli',
  AUG: 'August',
  SEP: 'September',
  OKT: 'Oktober',
  NOV: 'November',
  DEZ: 'Dezember',
};

/**
 * Baut aus den drei Datums-Spans ein lesbares Datum: "24. Oktober 2026".
 * Das Jahr steht nur dann in der Tabelle, wenn es nicht das laufende Jahr ist.
 */
function parseDate(block, now = new Date()) {
  if (!block) return null;
  const day = pick(block, /class="date day">\s*([^<]*?)\s*</);
  const month = pick(block, /class="date month">\s*([^<]*?)\s*</);
  if (!day || !month) return null;

  const year = pick(block, /class="date year">\s*(\d{4})\s*</) ?? String(now.getFullYear());
  const monthName = MONTH_NAMES[decodeEntities(month).toUpperCase()];

  // Unbekanntes Monatskuerzel lieber roh durchreichen als etwas Falsches anzeigen.
  if (!monthName) return `${day} ${month} ${year}`;
  return `${Number(day)}. ${monthName} ${year}`;
}

/**
 * Parst die Anfragen-Tabelle der Listenseite.
 * Eine Zeile sieht so aus: <tr id='row7959'> [Datum] [Titel+Teaser] [Typ] [OS] [Frist] [Budget] [VK] </tr>
 *
 * @param {string} html
 * @param {string} baseUrl
 * @returns {Array<object>}
 */
export function parseAnfragen(html, baseUrl) {
  const items = [];
  const rowRegex = /<tr\s+id=['"]row(\d+)['"][^>]*>([\s\S]*?)<\/tr>/gi;

  for (const match of html.matchAll(rowRegex)) {
    const id = Number(match[1]);
    const row = match[2];

    const link = row.match(/href=['"][^'"]*view=detail&(?:amp;)?id=([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
    const slug = link ? decodeEntities(link[1]) : String(id);
    const title = link ? text(link[2]) : `Anfrage ${id}`;

    // Erster Datumsblock = Eingangsdatum, zweiter (versteckter) = Frist.
    const dateBlocks = [...row.matchAll(/<td[^>]*class="[^"]*\bdate\b[^"]*"[\s\S]*?<\/td>/gi)].map(
      (m) => m[0],
    );

    // Die Euro-Spalten: erste = Budget, zweite = Verkaufspreis der Anfrage.
    const money = [...row.matchAll(/<td[^>]*>\s*(€[\d.,]+)\s*<\/td>/gi)].map((m) => m[1]);

    const osTitles = [...row.matchAll(/<img[^>]*class="os-icon"[^>]*title="([^"]*)"/gi)].map((m) =>
      decodeEntities(m[1]),
    );

    items.push({
      id,
      slug,
      title,
      // Die "schoene" URL /anfragen-app-programmierung/<slug> antwortet mit HTTP 500,
      // nur die index.php-Form funktioniert.
      url: `${baseUrl}/index.php?com=anfragen&view=detail&id=${id}`,
      date: parseDate(dateBlocks[0]),
      deadline: parseDate(dateBlocks[1]),
      type: pick(row, /<i\s+class=['"]icon icon-[^'"]*['"]\s+title=['"]([^'"]*)['"]/i),
      os: osTitles,
      budget: money[0] ?? null,
      teaser: text(pick(row, /<p[^>]*>([\s\S]*?)<\/p>/i)),
    });
  }

  return items;
}

async function fetchWithTimeout(url, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': config.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Holt die Listenseite mit einfachem Retry/Backoff und gibt die geparsten Anfragen zurueck.
 */
export async function fetchAnfragen(config, { attempts = 3 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(config.listUrl, config);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const html = await response.text();
      const items = parseAnfragen(html, config.baseUrl);
      if (items.length === 0 && !/id=['"]row\d+['"]/i.test(html)) {
        throw new Error(
          'Keine Anfragen-Zeilen gefunden - die Seitenstruktur hat sich vermutlich geaendert.',
        );
      }
      return items;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  throw new Error(`Abruf von ${config.listUrl} fehlgeschlagen: ${lastError.message}`);
}
