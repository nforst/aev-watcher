const MAX_TEXT_LENGTH = 4096;

/** Baut den WhatsApp-Text fuer eine Anfrage. */
export function formatMessage(item) {
  const meta = [item.date, item.type].filter(Boolean).join(' · ');
  const facts = [
    item.budget ? `Budget: ${item.budget}` : null,
    item.os?.length ? `OS: ${item.os.join(', ')}` : null,
    item.deadline ? `Frist: ${item.deadline}` : null,
  ].filter(Boolean);

  const lines = [
    `*Neue Anfrage: ${item.title}*`,
    meta || null,
    facts.length ? facts.join(' · ') : null,
    '',
    item.teaser || null,
    '',
    item.url,
  ].filter((line) => line !== null);

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

/**
 * Schickt einen Text ueber die OpenWA-Gateway-API.
 * POST {baseUrl}/api/sessions/{sessionId}/messages/send-text
 */
export async function sendText(config, text, { attempts = 3 } = {}) {
  const { baseUrl, apiKey, sessionId, chatId } = config.openwa;
  const url = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chatId, text }),
      });

      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`OpenWA HTTP ${response.status}: ${body.slice(0, 300)}`);
        // 4xx ausser 429 sind Konfigurationsfehler - erneutes Senden hilft nicht.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          error.permanent = true;
        }
        throw error;
      }

      try {
        return JSON.parse(body);
      } catch {
        return { raw: body };
      }
    } catch (error) {
      lastError = error;
      if (error.permanent || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`WhatsApp-Versand fehlgeschlagen: ${lastError.message}`);
}
