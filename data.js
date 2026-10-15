/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary: copying, cloning or AI-assisted recreation without written permission is prohibited. See LICENSE.txt. */
// Sign-in, the local copy of the department's records (IndexedDB) and two-way sync with the shared database.
// Records are stored exactly as the Android app stores them: records(tbl, pk, data jsonb) with every value a string.
(function () {
  'use strict';
  const C = window.CONFIG;
  const SKIP = { chat_messages: 1, chat_reads: 1, chat_keys: 1 };   // the encrypted duty chat stays on Android
  const TABLES = ['units', 'staff', 'patients', 'events', 'classes', 'academics', 'cmchis', 'settings', 'notices', 'attendance', 'leaves', 'dap',
    'callover', 'kdp_op', 'docs', 'cmchis_cases', 'pg_leaves', 'faculty_leaves', 'duty_roster', 'alerts', 'vip_cases', 'duty_sick', 'duty_notes',
    'ward_duty', 'case_sheets', 'acad_files', 'acad_attendance', 'mcqs', 'mcq_answers', 'plex', 'chats', 'cal_events', 'contacts', 'opinions',
    'dissertations', 'census', 'charts', 'spots', 'spot_comments', 'achievements', 'ccb_duty', 'ob_duty', 'og_cases', 'handovers', 'labs', 'tasks', 'logbook'];

  // ---------- session ----------
  const S = {
    get() { try { return JSON.parse(localStorage.getItem('tvm_session') || 'null'); } catch (e) { return null; } },
    set(s) { localStorage.setItem('tvm_session', JSON.stringify(s)); },
    clear() { localStorage.removeItem('tvm_session'); }
  };

  class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  async function http(method, path, body, token, headers) {
    const h = Object.assign({ apikey: C.key }, headers || {});
    if (token) h.Authorization = 'Bearer ' + token;
    else if (C.key.startsWith('eyJ')) h.Authorization = 'Bearer ' + C.key;
    if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
    let r;
    try {
      r = await fetch(C.url + path, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new HttpError(0, 'No internet connection');
    }
    const text = await r.text();
    if (!r.ok) {
      let msg = 'Server error ' + r.status;
      try { const o = JSON.parse(text); msg = o.msg || o.message || o.error_description || o.error || msg; } catch (e) { }
      throw new HttpError(r.status, msg);
    }
    return text ? (text[0] === '{' || text[0] === '[' || text[0] === '"' ? JSON.parse(text) : text) : null;
  }

  function saveSession(r, extra) {
    const s = Object.assign(S.get() || {}, extra || {}, {
      access: r.access_token, refresh: r.refresh_token,
      expires: Date.now() + 1000 * (r.expires_in || 3600),
      user_id: r.user ? r.user.id : (S.get() || {}).user_id
    });
    S.set(s);
    return s;
  }

  let refreshing = null;
  async function token() {
    const s = S.get();
    if (!s || !s.refresh) throw new HttpError(401, 'Not signed in');
    if (Date.now() < s.expires - 60000) return s.access;
    if (!refreshing) {
      refreshing = http('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh })
        .then(r => saveSession(r).access)
        .catch(e => { if (e.code === 400 || e.code === 401) { const x = S.get(); if (x) { delete x.refresh; S.set(x); } } throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function api(method, path, body, headers) {
    return http(method, path, body, await token(), headers);
  }

  const APPROVED = ['admin', 'hod', 'registrar', 'professor', 'faculty', 'pg', 'crmi', 'staff'];

  const Auth = {
    session: () => S.get(),
    signedIn: () => { const s = S.get(); return !!(s && s.refresh); },
    role: () => (S.get() || {}).role || '',
    approved: () => Auth.signedIn() && APPROVED.includes(Auth.role()),
    isAdmin: () => ['admin', 'hod', 'registrar'].includes(Auth.role()),
    isOwner: () => Auth.role() === 'admin',
    staffId: () => { const s = S.get(); return s && s.staff_id > 0 ? String(s.staff_id) : ''; },
    async signIn(email, password, name, create) {
      const body = { email, password };
      if (create) {
        body.data = { name };
        const r = await http('POST', '/auth/v1/signup', body);
        if (!r.access_token) return 'Account created. Open the confirmation email, then sign in here.';
        saveSession(r, { email, name });
      } else {
        const r = await http('POST', '/auth/v1/token?grant_type=password', body);
        saveSession(r, { email, name: name || '' });
      }
      await Auth.join(name || '');
      return null;
    },
    async reset(email) { await http('POST', '/auth/v1/recover', { email }); },
    /** Registers with the department (the first person becomes admin) and refreshes the role and staff link. */
    async join(name) {
      const role = String(await api('POST', '/rest/v1/rpc/join_department', { p_name: name || '' })).replace(/"/g, '').trim();
      const s = S.get();
      s.role = role;
      try {
        const me = await api('GET', '/rest/v1/members?select=staff_id,name&user_id=eq.' + s.user_id);
        if (me && me.length) { s.staff_id = me[0].staff_id == null ? -1 : me[0].staff_id; if (me[0].name) s.name = me[0].name; }
      } catch (e) { }
      s.checked = Date.now();
      S.set(s);
      return role;
    },
    async signOut() {
      S.clear();
      await Store.wipe();
      Lock.clear();
    }
  };

  // ---------- local store (IndexedDB) ----------
  let idb = null;
  const mem = {};          // tbl -> Map(pk -> data)
  const kv = {};           // last_seq, id_base, id_next, outbox (array of "tbl|pk")
  TABLES.forEach(t => { mem[t] = new Map(); });

  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('tvmchmed', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('rec'); r.result.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  function tx(stores, mode) { return idb.transaction(stores, mode); }
  function done(t) { return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }

  const Store = {
    ready: false,
    async open() {
      idb = await openDb();
      await new Promise((res, rej) => {
        const t = tx(['rec', 'kv'], 'readonly');
        const c = t.objectStore('rec').openCursor();
        c.onsuccess = () => {
          const cur = c.result;
          if (!cur) return;
          const v = cur.value;
          if (mem[v.tbl]) mem[v.tbl].set(v.pk, v.data);
          cur.continue();
        };
        const k = t.objectStore('kv').openCursor();
        k.onsuccess = () => { const cur = k.result; if (!cur) return; kv[cur.key] = cur.value; cur.continue(); };
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
      });
      if (!Array.isArray(kv.outbox)) kv.outbox = [];
      Store.ready = true;
    },
    all(tbl) { return Array.from((mem[tbl] || new Map()).values()); },
    get(tbl, pk) { const m = mem[tbl]; return m ? m.get(String(pk)) || null : null; },
    where(tbl, fn) { return Store.all(tbl).filter(fn); },
    setting(k, def) { const r = Store.get('settings', k); return r && r.v != null ? r.v : def; },
    kv(k, def) { return kv[k] === undefined ? def : kv[k]; },
    async setKv(k, v) { kv[k] = v; const t = tx(['kv'], 'readwrite'); t.objectStore('kv').put(v, k); await done(t); },
    /** A new id from this browser's block (claim_device() << 32), like a phone. */
    newId() {
      const base = Number(kv.id_base || 0);
      if (!base) throw new Error('Not ready to save yet: connect to the internet once after signing in.');
      const n = Number(kv.id_next || 0) + 1;
      kv.id_next = n;
      const t = tx(['kv'], 'readwrite'); t.objectStore('kv').put(n, 'id_next');
      return String(base + n);
    },
    keyCol(tbl) { return tbl === 'units' ? 'code' : tbl === 'settings' ? 'k' : tbl === 'census' ? 'day' : 'id'; },
    /** Saves a row locally (values become strings) and queues it for upload. Returns the row. */
    async put(tbl, row) {
      const key = Store.keyCol(tbl);
      if (row[key] == null || row[key] === '') row[key] = Store.newId();
      const data = {};
      for (const k in row) data[k] = row[k] == null ? null : String(row[k]);
      const pk = String(data[key]);
      mem[tbl].set(pk, data);
      queue(tbl, pk);
      const t = tx(['rec', 'kv'], 'readwrite');
      t.objectStore('rec').put({ tbl, pk, data }, tbl + '|' + pk);
      t.objectStore('kv').put(kv.outbox, 'outbox');
      await done(t);
      Sync.soon();
      return data;
    },
    /** Merges fields into an existing row (keeps every column the Android app wrote). */
    async update(tbl, pk, fields) {
      const cur = Store.get(tbl, pk);
      if (!cur) throw new Error('Record not found');
      return Store.put(tbl, Object.assign({}, cur, fields));
    },
    async remove(tbl, pk) {
      pk = String(pk);
      mem[tbl].delete(pk);
      queue(tbl, pk);
      const t = tx(['rec', 'kv'], 'readwrite');
      t.objectStore('rec').delete(tbl + '|' + pk);
      t.objectStore('kv').put(kv.outbox, 'outbox');
      await done(t);
      Sync.soon();
    },
    async wipe() {
      TABLES.forEach(t => mem[t].clear());
      for (const k in kv) delete kv[k];
      kv.outbox = [];
      if (!idb) return;
      const t = tx(['rec', 'kv'], 'readwrite');
      t.objectStore('rec').clear();
      t.objectStore('kv').clear();
      await done(t);
    },
    pending() { return kv.outbox.length; }
  };

  function queue(tbl, pk) {
    const id = tbl + '|' + pk;
    if (!kv.outbox.includes(id)) kv.outbox.push(id);
  }

  // ---------- sync ----------
  const OVERLAP = 200;
  const listeners = [];
  let running = null, timer = null;

  const Sync = {
    lastError: '',
    lastSync: 0,
    onChange(fn) { listeners.push(fn); },
    soon() { clearTimeout(timer); timer = setTimeout(() => Sync.run(), 800); },
    run() {
      if (!running) running = runOnce().finally(() => { running = null; });
      return running;
    }
  };

  async function runOnce() {
    if (!Auth.signedIn() || !navigator.onLine) return false;
    let changed = false;
    try {
      const s = S.get();
      if (!s.checked || Date.now() - s.checked > 120000) {
        const before = s.role;
        await Auth.join('');
        if (!Auth.approved()) {
          if (Auth.role() === 'blocked') await Store.wipe();
          listeners.forEach(f => f(true));
          return true;
        }
        if (before !== Auth.role()) changed = true;
      }
      if (!Auth.approved()) return false;
      if (!kv.id_base) {
        const dev = Number(String(await api('POST', '/rest/v1/rpc/claim_device', {})).trim());
        await Store.setKv('id_base', dev * 4294967296);
        await Store.setKv('id_next', 0);
      }
      await push();
      changed = (await pull()) || changed;
      Sync.lastError = '';
      Sync.lastSync = Date.now();
    } catch (e) {
      Sync.lastError = e.message || String(e);
      if (e.code === 401) { const x = S.get(); if (x && !x.refresh) changed = true; }
    }
    listeners.forEach(f => f(changed));
    return changed;
  }

  async function push() {
    while (kv.outbox.length) {
      const box = kv.outbox.slice(0, 100);
      const arr = box.map(id => {
        const i = id.indexOf('|'), tbl = id.slice(0, i), pk = id.slice(i + 1);
        const data = mem[tbl] ? mem[tbl].get(pk) : null;
        return data ? { tbl, pk, deleted: false, data, owner_staff: tbl === 'docs' && data.staff_id ? Number(data.staff_id) : null }
          : { tbl, pk, deleted: true, data: null, owner_staff: null };
      });
      const up = a => api('POST', '/rest/v1/records?on_conflict=tbl,pk', a, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      try {
        await up(arr);
      } catch (e) {
        if (![400, 401, 403, 409].includes(e.code)) throw e;
        // one row the server refuses (e.g. another unit's case sheet) must not block the rest
        for (const r of arr) {
          try { await up([r]); } catch (one) { if (![400, 401, 403, 409].includes(one.code)) throw one; }
        }
      }
      kv.outbox = kv.outbox.filter(id => !box.includes(id));
      await Store.setKv('outbox', kv.outbox);
    }
  }

  async function pull() {
    let changed = false;
    for (;;) {
      const since = Number(kv.last_seq || 0);
      const arr = await api('GET', '/rest/v1/records?select=tbl,pk,data,deleted,seq&seq=gt.' + Math.max(0, since - OVERLAP) + '&order=seq.asc&limit=1000');
      let max = since, fresh = 0;
      const t = tx(['rec', 'kv'], 'readwrite');
      const rs = t.objectStore('rec');
      for (const r of arr) {
        if (r.seq > since) fresh++;
        max = Math.max(max, r.seq);
        if (!mem[r.tbl] || SKIP[r.tbl]) continue;
        if (r.tbl === 'settings' && r.pk === 'faculty_pin') continue;
        if (kv.outbox.includes(r.tbl + '|' + r.pk)) continue;
        const cur = mem[r.tbl].get(r.pk);
        if (r.deleted || !r.data) {
          if (cur) { mem[r.tbl].delete(r.pk); rs.delete(r.tbl + '|' + r.pk); changed = true; }
          continue;
        }
        const data = {};
        for (const k in r.data) data[k] = r.data[k] == null ? null : String(r.data[k]);
        if (cur && JSON.stringify(cur) === JSON.stringify(data)) continue;
        mem[r.tbl].set(r.pk, data);
        rs.put({ tbl: r.tbl, pk: r.pk, data }, r.tbl + '|' + r.pk);
        changed = true;
      }
      kv.last_seq = max;
      t.objectStore('kv').put(max, 'last_seq');
      await done(t);
      if (fresh === 0 || arr.length < 1000) return changed;
    }
  }

  // ---------- app lock (PIN, this browser only) ----------
  const LOCK_KEY = 'tvm_lock';
  const Lock = {
    MAX_TRIES: 5,
    unlocked: false,
    hiddenAt: 0,
    cfg() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}'); } catch (e) { return {}; } },
    save(c) { localStorage.setItem(LOCK_KEY, JSON.stringify(c)); },
    hasPin() { return !!Lock.cfg().hash; },
    after() { return Lock.cfg().after || 3; },
    setAfter(m) { const c = Lock.cfg(); c.after = m; Lock.save(c); },
    needed() {
      if (!Auth.approved()) return false;
      if (!Lock.hasPin() || !Lock.unlocked) return true;
      return Lock.hiddenAt > 0 && Date.now() - Lock.hiddenAt >= Lock.after() * 60000;
    },
    async hash(pin, salt) {
      const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, k, 256);
      return btoa(String.fromCharCode.apply(null, new Uint8Array(bits)));
    },
    async setPin(pin) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const c = Lock.cfg();
      c.salt = btoa(String.fromCharCode.apply(null, salt));
      c.hash = await Lock.hash(pin, salt);
      c.fails = 0;
      Lock.save(c);
      Lock.unlock();
    },
    async check(pin) {
      const c = Lock.cfg();
      const salt = Uint8Array.from(atob(c.salt || ''), ch => ch.charCodeAt(0));
      const ok = !!c.hash && (await Lock.hash(pin, salt)) === c.hash;
      c.fails = ok ? 0 : (c.fails || 0) + 1;
      Lock.save(c);
      if (ok) Lock.unlock();
      return ok;
    },
    triesLeft() { return Math.max(0, Lock.MAX_TRIES - (Lock.cfg().fails || 0)); },
    unlock() { Lock.unlocked = true; Lock.hiddenAt = 0; },
    clear() { const c = Lock.cfg(); Lock.save({ after: c.after }); Lock.unlocked = false; Lock.hiddenAt = 0; }
  };

  window.TVM = { Auth, Store, Sync, Lock, api, token, HttpError, TABLES };
})();
