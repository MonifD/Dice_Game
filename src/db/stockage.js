/**
 * Stockage de l'état des parties.
 *
 * - En production : Redis (Upstash, Redis Cloud, etc.). L'état est partagé entre
 *   toutes les instances du serveur, ce qui est indispensable sur Vercel (plusieurs
 *   instances, connexions limitées dans le temps).
 * - En local sans REDIS_URL : stockage en mémoire avec la MÊME interface
 *   (une seule instance possible dans ce cas).
 *
 * Interface minimale (toutes les méthodes sont asynchrones) :
 *   get, set(cle, valeur, ttlMs?), del, sadd, srem, smembers,
 *   hset, hsetnx, hget, hgetall, hdel, hlen, expire, incr, lpush, ltrim, lrange, ttl,
 *   prendreVerrou(cle, ttlMs) -> jeton|null, libererVerrou(cle, jeton)
 */
const crypto = require('crypto');
const config = require('../config');

// Script Lua : supprime le verrou seulement si on en est le propriétaire.
const LUA_LIBERER = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

class StockageRedis {
  constructor(url) {
    const Redis = require('ioredis');
    const options = { maxRetriesPerRequest: 3, enableAutoPipelining: true };
    this.client = new Redis(url, options);
    this.client.on('error', (e) => console.error('[redis]', e.message));
    this.url = url;
    this.type = 'redis';
  }
  /** Crée un nouveau client (pour le pub/sub de l'adaptateur Socket.IO). */
  dupliquer() { return this.client.duplicate(); }

  get(c) { return this.client.get(c); }
  set(c, v, ttlMs) { return ttlMs ? this.client.set(c, v, 'PX', ttlMs) : this.client.set(c, v); }
  del(c) { return this.client.del(c); }
  sadd(c, m) { return this.client.sadd(c, m); }
  srem(c, m) { return this.client.srem(c, m); }
  smembers(c) { return this.client.smembers(c); }
  hset(c, champ, v) { return this.client.hset(c, champ, v); }
  hsetnx(c, champ, v) { return this.client.hsetnx(c, champ, v); }
  hget(c, champ) { return this.client.hget(c, champ); }
  hgetall(c) { return this.client.hgetall(c); }
  hdel(c, champ) { return this.client.hdel(c, champ); }
  hlen(c) { return this.client.hlen(c); }
  expire(c, sec) { return this.client.expire(c, sec); }
  incr(c) { return this.client.incr(c); }
  lpush(c, v) { return this.client.lpush(c, v); }
  ltrim(c, debut, fin) { return this.client.ltrim(c, debut, fin); }
  lrange(c, debut, fin) { return this.client.lrange(c, debut, fin); }
  ttl(c) { return this.client.pttl(c); }

  async prendreVerrou(cle, ttlMs) {
    const jeton = crypto.randomBytes(8).toString('hex');
    const ok = await this.client.set(cle, jeton, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? jeton : null;
  }
  libererVerrou(cle, jeton) { return this.client.eval(LUA_LIBERER, 1, cle, jeton); }
}

class StockageMemoire {
  constructor() {
    this.donnees = new Map(); // cle -> { v, expire }
    this.type = 'memoire';
  }
  _lire(c) {
    const e = this.donnees.get(c);
    if (!e) return undefined;
    if (e.expire && e.expire < Date.now()) { this.donnees.delete(c); return undefined; }
    return e.v;
  }
  _ecrire(c, v, ttlMs) { this.donnees.set(c, { v, expire: ttlMs ? Date.now() + ttlMs : 0 }); }
  _hash(c) { let h = this._lire(c); if (!(h instanceof Map)) { h = new Map(); this._ecrire(c, h); } return h; }
  _set(c) { let s = this._lire(c); if (!(s instanceof Set)) { s = new Set(); this._ecrire(c, s); } return s; }

  async get(c) { const v = this._lire(c); return typeof v === 'string' ? v : null; }
  async set(c, v, ttlMs) { this._ecrire(c, String(v), ttlMs); return 'OK'; }
  async del(c) { return this.donnees.delete(c) ? 1 : 0; }
  async sadd(c, m) { this._set(c).add(String(m)); return 1; }
  async srem(c, m) { return this._set(c).delete(String(m)) ? 1 : 0; }
  async smembers(c) { return [...this._set(c)]; }
  async hset(c, f, v) { this._hash(c).set(String(f), String(v)); return 1; }
  async hsetnx(c, f, v) { const h = this._hash(c); if (h.has(String(f))) return 0; h.set(String(f), String(v)); return 1; }
  async hget(c, f) { const h = this._lire(c); return h instanceof Map && h.has(String(f)) ? h.get(String(f)) : null; }
  async hgetall(c) { const h = this._lire(c); return h instanceof Map ? Object.fromEntries(h) : {}; }
  async hdel(c, f) { const h = this._lire(c); return h instanceof Map && h.delete(String(f)) ? 1 : 0; }
  async hlen(c) { const h = this._lire(c); return h instanceof Map ? h.size : 0; }
  async expire(c, sec) { const e = this.donnees.get(c); if (e) e.expire = Date.now() + sec * 1000; return e ? 1 : 0; }
  async incr(c) {
    const e = this.donnees.get(c);
    const n = parseInt(this._lire(c) || '0', 10) + 1;
    this._ecrire(c, String(n));
    if (e && e.expire > Date.now()) this.donnees.get(c).expire = e.expire; // garde l'expiration comme Redis
    return n;
  }
  _liste(c) { let l = this._lire(c); if (!Array.isArray(l)) { l = []; this._ecrire(c, l); } return l; }
  async lpush(c, v) { const l = this._liste(c); l.unshift(String(v)); return l.length; }
  async ltrim(c, debut, fin) { const l = this._liste(c); l.splice(fin + 1); l.splice(0, debut); return 'OK'; }
  async lrange(c, debut, fin) { const l = this._lire(c); return Array.isArray(l) ? l.slice(debut, fin === -1 ? undefined : fin + 1) : []; }
  async ttl(c) { const e = this.donnees.get(c); return e?.expire ? Math.max(0, e.expire - Date.now()) : -1; }

  async prendreVerrou(cle, ttlMs) {
    if (this._lire(cle) !== undefined) return null;
    const jeton = crypto.randomBytes(8).toString('hex');
    this._ecrire(cle, jeton, ttlMs);
    return jeton;
  }
  async libererVerrou(cle, jeton) { if (this._lire(cle) === jeton) this.donnees.delete(cle); return 1; }
}

const stockage = config.redisUrl ? new StockageRedis(config.redisUrl) : new StockageMemoire();
if (stockage.type === 'memoire') {
  console.warn('[stockage] REDIS_URL absent : état des parties en mémoire (une seule instance).');
}

/**
 * Exécute `fn` en tenant le verrou `cle` (attente active courte si déjà pris).
 * Garantit qu'une seule instance modifie une salle à la fois.
 */
async function avecVerrou(cle, fn, { ttlMs = 5000, attenteMaxMs = 4000 } = {}) {
  const debut = Date.now();
  let jeton = null;
  let pause = 5;
  while (!(jeton = await stockage.prendreVerrou(cle, ttlMs))) {
    if (Date.now() - debut > attenteMaxMs) throw new Error('Serveur occupé, réessaie.');
    await new Promise((r) => setTimeout(r, pause + Math.random() * pause));
    pause = Math.min(pause * 2, 50);
  }
  try {
    return await fn();
  } finally {
    await stockage.libererVerrou(cle, jeton).catch(() => {});
  }
}

module.exports = { stockage, avecVerrou };
