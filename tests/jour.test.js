/** Jour de jeu : un jour commence à 3h00, heure de Paris (src/services/jour.js). */
const test = require('node:test');
const assert = require('node:assert');
const j = require('../src/services/jour');

test('avant 3h du matin, on est encore la veille', () => {
  // 24/11 à 1h00 à Paris (UTC+1) = 24/11 00:00 UTC
  assert.strictEqual(j.jourDeJeu(new Date('2026-11-24T00:00:00Z')), '2026-11-23');
  // 24/11 à 2h59 à Paris
  assert.strictEqual(j.jourDeJeu(new Date('2026-11-24T01:59:00Z')), '2026-11-23');
});

test('à partir de 3h00, c\'est le nouveau jour', () => {
  assert.strictEqual(j.jourDeJeu(new Date('2026-11-24T02:00:00Z')), '2026-11-24');
  assert.strictEqual(j.jourDeJeu(new Date('2026-11-24T22:59:00Z')), '2026-11-24');
  // 23h30 à Paris le 24/11 = toujours le 24/11
  assert.strictEqual(j.jourDeJeu(new Date('2026-11-24T22:30:00Z')), '2026-11-24');
});

test('heure d\'été (UTC+2)', () => {
  assert.strictEqual(j.jourDeJeu(new Date('2026-07-10T00:30:00Z')), '2026-07-09'); // 2h30 à Paris
  assert.strictEqual(j.jourDeJeu(new Date('2026-07-10T01:00:00Z')), '2026-07-10'); // 3h00 à Paris
});

test('changement de mois et d\'année', () => {
  assert.strictEqual(j.jourDeJeu(new Date('2027-01-01T00:30:00Z')), '2026-12-31');
  assert.strictEqual(j.ajouterJours('2026-02-28', 1), '2026-03-01');
});

test('validation des dates', () => {
  assert.ok(j.estJour('2026-11-24'));
  assert.ok(!j.estJour('2026-02-30') && !j.estJour('24/11/2026') && !j.estJour(''));
  assert.strictEqual(j.ecartJours('2026-11-23', '2026-11-28'), 5);
});
