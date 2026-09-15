import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { formatMessage } from '../src/message.js';
import { parseAnfragen } from '../src/scraper.js';
import { WhatsAppClient } from '../src/whatsapp.js';

const BASE_URL = 'https://app-entwickler-verzeichnis.de';
const fixture = await readFile(fileURLToPath(new URL('./fixtures/listing.html', import.meta.url)), 'utf8');
const items = parseAnfragen(fixture, BASE_URL);

test('findet alle Anfragen-Zeilen', () => {
  assert.equal(items.length, 9);
  assert.deepEqual(
    items.map((item) => item.id),
    [7959, 7956, 7903, 7853, 7813, 7798, 7789, 7778, 7770],
  );
});

test('liest alle Felder einer Zeile', () => {
  const item = items.find((entry) => entry.id === 7959);
  assert.equal(item.title, 'Mobile Player');
  assert.equal(item.date, '19 AUG');
  assert.equal(item.deadline, '31 AUG');
  assert.equal(item.type, 'Firmenanfrage');
  assert.equal(item.budget, '€12.000');
  assert.deepEqual(item.os, ['iOS (iPhone/iPad)', 'Android']);
  assert.match(item.teaser, /^Ich suche eine erfahrene Flutter-Entwicklerin/);
  assert.equal(item.url, `${BASE_URL}/anfragen-app-programmierung/7959-Mobile+Player`);
});

test('dekodiert Umlaute in Titel und URL', () => {
  const item = items.find((entry) => entry.id === 7789);
  assert.equal(item.title, 'APP für Taxi- und Courierdienstleister');
  assert.ok(item.url.includes('f%C3%BCr'));
});

test('kommt mit fehlender Frist klar', () => {
  const item = items.find((entry) => entry.id === 7956);
  assert.equal(item.deadline, null);
  assert.equal(item.date, '30 JUL');
});

test('gibt bei fremdem HTML keine Treffer zurueck', () => {
  assert.deepEqual(parseAnfragen('<html><body><p>nichts</p></body></html>', BASE_URL), []);
});

test('formatiert eine WhatsApp-Nachricht mit allen Angaben', () => {
  const message = formatMessage(items.find((entry) => entry.id === 7959));
  assert.match(message, /\*Neue Anfrage: Mobile Player\*/);
  assert.match(message, /19 AUG · Firmenanfrage/);
  assert.match(message, /Budget: €12\.000 · OS: iOS \(iPhone\/iPad\), Android · Frist: 31 AUG/);
  assert.match(message, /7959-Mobile\+Player$/);
  assert.ok(message.length <= 4096);
});

test('kuerzt zu lange Nachrichten auf das WhatsApp-Limit', () => {
  const message = formatMessage({ title: 'X', teaser: 'a'.repeat(6000), url: BASE_URL, os: [] });
  assert.equal(message.length, 4096);
  assert.ok(message.endsWith('…'));
});

test('normalisiert Telefonnummern zur WhatsApp-JID', () => {
  const client = new WhatsAppClient({ authDir: '/tmp/aev-watcher-test' }, () => {});

  assert.equal(client.resolveJid('+49 151 12345678'), '4915112345678@s.whatsapp.net');
  assert.equal(client.resolveJid('0049151123456'), '49151123456@s.whatsapp.net');
  assert.equal(client.resolveJid('49151123456@s.whatsapp.net'), '49151123456@s.whatsapp.net');
  assert.equal(client.resolveJid('49151123456@c.us'), '49151123456@s.whatsapp.net');
  assert.equal(client.resolveJid('120363000000000000@g.us'), '120363000000000000@g.us');

  assert.throws(() => client.resolveJid('0151123456'), /Laendervorwahl/);
  assert.throws(() => client.resolveJid('123'), /gueltigen Nummer/);
  // "self" laesst sich erst nach dem Verbinden aufloesen.
  assert.throws(() => client.resolveJid('self'), /erst verbinden/);
});
