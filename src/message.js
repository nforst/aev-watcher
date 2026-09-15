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
