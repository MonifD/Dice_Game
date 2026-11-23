/**
 * « Jour de jeu » de l'alliance : un jour commence à 3h00 du matin (heure de Paris)
 * et se termine le lendemain à 2h59. Exemple : le 24/11 à 1h du matin, on est encore le 23/11.
 * Miroir côté navigateur : LW.aujourdhui() (public/js/commun.js).
 */
const FUSEAU = 'Europe/Paris';
const HEURE_DEBUT = 3;

const format = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

/** Ajoute n jours à « AAAA-MM-JJ ». */
function ajouterJours(jour, n) {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jour de jeu (« AAAA-MM-JJ ») à l'instant donné. */
function jourDeJeu(instant = new Date()) {
  const p = Object.fromEntries(format.formatToParts(instant).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return Number(p.hour) < HEURE_DEBUT ? ajouterJours(date, -1) : date;
}

const aujourdhui = () => jourDeJeu(new Date());

/** « AAAA-MM-JJ » valide ? */
function estJour(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Écart en jours entre deux « AAAA-MM-JJ » (b - a). */
const ecartJours = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

/** « AAAA-MM-JJ » -> Date (colonne DATE de PostgreSQL). */
const versDate = (jour) => new Date(`${jour}T00:00:00Z`);
/** Date (colonne DATE) -> « AAAA-MM-JJ ». */
const depuisDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

module.exports = { FUSEAU, HEURE_DEBUT, jourDeJeu, aujourdhui, ajouterJours, estJour, ecartJours, versDate, depuisDate };
