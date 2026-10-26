/**
 * Paramètres communs à tous les mini-jeux + validation des valeurs envoyées
 * par l'organisateur (on ne fait jamais confiance au navigateur).
 */
const { ErreurJeu } = require('./outils');

function parametresCommuns(module) {
  const communs = [
    {
      cle: 'dureeTour', libelle: 'Temps par tour (secondes)', type: 'nombre',
      min: 3, max: 180, defaut: module.dureeTourDefaut || 30, commun: true,
    },
    { cle: 'avanceAuto', libelle: 'Tour suivant automatique', type: 'booleen', defaut: true, commun: true },
    { cle: 'pauseResultats', libelle: 'Durée de l\'écran des résultats (secondes)', type: 'nombre', min: 2, max: 60, defaut: 6, commun: true },
    { cle: 'toursMax', libelle: 'Nombre de tours max avant départage', type: 'nombre', min: 1, max: 300, defaut: module.toursMaxDefaut || 60, commun: true },
  ];
  // Un module peut masquer un paramètre commun qui n'a pas de sens pour lui.
  const masques = module.parametresCommunsMasques || [];
  return communs.filter((p) => !masques.includes(p.cle));
}

/** Valide et complète les paramètres ; lève ErreurJeu si une valeur est invalide. */
function validerParametres(module, recus = {}) {
  const defs = [...(module.parametres || []), ...parametresCommuns(module)];
  const params = {};
  for (const d of defs) {
    let v = recus[d.cle];
    if (v === undefined || v === null || v === '') v = d.defaut;
    switch (d.type) {
      case 'nombre': {
        v = Number(v);
        if (!Number.isFinite(v)) throw new ErreurJeu(`« ${d.libelle} » doit être un nombre.`);
        if (d.entier !== false) v = Math.round(v);
        if (d.min !== undefined && v < d.min) throw new ErreurJeu(`« ${d.libelle} » : minimum ${d.min}.`);
        if (d.max !== undefined && v > d.max) throw new ErreurJeu(`« ${d.libelle} » : maximum ${d.max}.`);
        break;
      }
      case 'booleen':
        v = v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
        break;
      case 'choix':
        v = String(v);
        if (!d.options.some((o) => String(o.valeur) === v)) throw new ErreurJeu(`« ${d.libelle} » : valeur non autorisée.`);
        break;
      case 'texte':
        v = String(v).slice(0, d.max || 200);
        break;
      default:
    }
    params[d.cle] = v;
  }
  if (typeof module.validerParametres === 'function') module.validerParametres(params); // règles croisées
  return params;
}

module.exports = { parametresCommuns, validerParametres };
