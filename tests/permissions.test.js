/** Règles de droits (src/services/permissions.js) : hiérarchie, rôles, rang R5. */
const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/services/permissions');

const SA = { id: 1, role: 'SUPER_ADMIN', rang: 'R5' };
const R5 = { id: 2, role: 'JOUEUR', rang: 'R5' };
const R4A = { id: 3, role: 'ADMIN', rang: 'R4' };
const R4A2 = { id: 4, role: 'ADMIN', rang: 'R4' };
const A = { id: 5, role: 'ADMIN', rang: 'R3' };
const R4 = { id: 6, role: 'JOUEUR', rang: 'R4' };
const J = { id: 7, role: 'JOUEUR', rang: 'R1' };
const J3 = { id: 11, role: 'JOUEUR', rang: 'R3' };
const permis = (auteur, cible, chg) => p.refusChangement(auteur, cible, chg) === null;

test('niveaux : super admin > R5 > R4 admin > admin > joueur', () => {
  assert.deepStrictEqual([SA, R5, R4A, A, R4, J].map(p.niveau), [4, 3, 2, 1, 0, 0]);
});

test('le R5 a les droits du super admin, même sans être admin', () => {
  assert.ok(p.estAdmin(R5) && p.aDroitsSuperAdmin(R5) && p.peutChangerRoles(R5));
  assert.ok(permis(R5, J3, { role: 'ADMIN' }) && permis(R5, R4A, { role: 'JOUEUR' }) && permis(R5, J, { rang: 'R5' }));
  assert.ok(!p.peutModifierCompte(R5, SA), 'personne ne modifie le super admin');
});

test('le R4 admin change les rangs (jusqu\'à R4) et les rôles des comptes plus bas', () => {
  assert.ok(permis(R4A, J3, { role: 'ADMIN' }) && permis(R4A, A, { role: 'JOUEUR' }) && permis(R4A, J, { rang: 'R4' }));
  assert.ok(!permis(R4A, J, { rang: 'R5' }), 'pas de R5');
  assert.ok(!p.peutModifierCompte(R4A, R5) && !p.peutModifierCompte(R4A, R4A2), 'ni le R5 ni un autre R4 admin');
  assert.ok(!p.aDroitsSuperAdmin(R4A), 'pas les journaux');
});

test('l\'admin simple garde ses droits, sans nommer d\'admin ni donner R5', () => {
  assert.ok(permis(A, J, { rang: 'R4' }) && permis(A, R4, { rang: 'R1' }));
  assert.ok(!permis(A, J3, { role: 'ADMIN' }) && !permis(A, J, { rang: 'R5' }) && !p.peutModifierCompte(A, A));
});

test('R4 / R5 sans admin : organisent des parties ; le R4 seul n\'administre pas', () => {
  assert.ok(p.peutOrganiser(R4) && p.peutOrganiser(R5) && !p.estAdmin(R4) && !p.peutOrganiser(J));
});

test('un R1 ou un R2 ne peut pas être admin', () => {
  assert.ok(!permis(R5, J, { role: 'ADMIN' }), 'R1');
  assert.ok(!permis(SA, { id: 8, role: 'JOUEUR', rang: 'R2' }, { role: 'ADMIN' }), 'R2');
  assert.ok(permis(R4A, { id: 9, role: 'JOUEUR', rang: 'R3' }, { role: 'ADMIN' }), 'R3 oui');
  assert.ok(!permis(SA, A, { rang: 'R1' }), 'descendre un admin en R1 sans retirer le rôle');
  assert.ok(permis(SA, A, { rang: 'R1', role: 'JOUEUR' }), 'en retirant le rôle');
  assert.strictEqual(p.niveau({ id: 10, role: 'ADMIN', rang: 'R2' }), 0, 'un ancien admin R2 n\'a aucun droit');
});

test('personne ne se modifie soi-même', () => {
  for (const j of [SA, R5, R4A, A]) assert.ok(!p.peutModifierCompte(j, j));
});
