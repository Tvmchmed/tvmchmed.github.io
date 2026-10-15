/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary: copying, cloning or AI-assisted recreation without written permission is prohibited. See LICENSE.txt. */
// Screens of the web app (for iPhone and iPad): sign-in, PIN lock, home, wards, patients, admission, transfer, discharge, notices, phone book.
(function () {
  'use strict';
  const { Auth, Store, Sync, Lock, api } = window.TVM;
  const { h, toast, sheet, confirmBox, Form, diagnosisPicker } = window.UI;
  const SC = window.SCHEMA;
  const app = document.getElementById('app');
  const FOOT = '© 2026 Dr. S. Rajkumar. All rights reserved.\nCopying or cloning this app\'s design, with or without AI, needs the owner\'s written permission.';

  // ---------- layout ----------
  function page(title, sub, content, opts) {
    opts = opts || {};
    app.innerHTML = '';
    const top = h('header.top',
      opts.back ? h('button.back', { onclick: () => history.length > 1 ? history.back() : go('#/') , 'aria-label': 'Back' }, '‹') : null,
      h('div.tt', h('h1', title), sub ? h('div.sub', sub) : null),
      Auth.approved() ? h('span.cloud', { onclick: () => go('#/account') }, Sync.lastError ? '☁ !' : Store.pending() ? '☁ ' + Store.pending() : '☁ ✓') : null,
      opts.action ? h('button.act', { onclick: opts.action[1] }, opts.action[0]) : null);
    if (opts.color) top.style.background = 'linear-gradient(90deg,' + opts.color + ', color-mix(in srgb,' + opts.color + ' 70%, #0B2E5C))';
    app.appendChild(top);
    app.appendChild(h('main', content, h('div.foot', { style: { whiteSpace: 'pre-line' } }, FOOT)));
    if (opts.tab !== false) app.appendChild(tabs(opts.tab || ''));
    window.scrollTo(0, opts.keepScroll || 0);
  }

  function tabs(on) {
    const t = (key, glyph, label) => h('a' + (on === key ? '.on' : ''), { href: '#/' + key }, h('span.g', glyph), label);
    return h('nav.tabs', t('', '⌂', 'Home'), t('wards', '🛏', 'Wards'), t('search', '⌕', 'Patients'), t('notices', '📌', 'Notices'), t('account', '☺', 'Me'));
  }

  const heading = (t, color) => h('div.heading', { vars: color ? { '--hc': color } : null }, t);
  const kv = (k, v) => (v == null || v === '' ? null : h('div.kv', h('b', k), h('span', v)));
  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

  // ---------- start ----------
  async function start() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
    await Store.open();
    window.addEventListener('hashchange', render);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (Lock.unlocked) Lock.hiddenAt = Date.now(); }
      else { if (Lock.needed()) render(); else { Lock.hiddenAt = 0; Sync.run(); } }
    });
    window.addEventListener('online', () => Sync.run());
    Sync.onChange(changed => { if (changed && !document.getElementById('sheet').innerHTML && !editing()) render(true); else refreshCloud(); });
    setInterval(() => { if (!document.hidden) Sync.run(); }, 30000);
    render();
    if (Auth.signedIn()) Sync.run();
  }

  /** Do not redraw while someone is filling a form (admission, edit) or typing anywhere. */
  const editing = () => {
    if (/^#\/(admit|edit)\//.test(location.hash)) return true;
    const a = document.activeElement;
    return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
  };

  function refreshCloud() {
    const c = document.querySelector('.top .cloud');
    if (c) c.textContent = Sync.lastError ? '☁ !' : Store.pending() ? '☁ ' + Store.pending() : '☁ ✓';
  }

  function render(keep) {
    const y = keep ? window.scrollY : 0;
    if (!Auth.signedIn()) return signIn();
    if (!Auth.approved()) return waiting();
    if (Lock.needed()) return lockScreen();
    if (!Store.kv('last_seq', 0)) return firstSync();
    const [path, arg, arg2, arg3] = location.hash.replace(/^#\/?/, '').split('/');
    const r = ROUTES[path || ''] || home;
    r(arg ? decodeURIComponent(arg) : '', arg2 ? decodeURIComponent(arg2) : '', arg3 ? decodeURIComponent(arg3) : '');
    if (keep) window.scrollTo(0, y);
  }

  // ---------- sign-in ----------
  function signIn() {
    let create = false;
    const f = new Form();
    const err = h('div.err');
    const draw = () => {
      f.el.innerHTML = ''; f.fields = {}; f.rows = {};
      if (create) f.text('name', 'Your name (as on the staff list, e.g. Dr. K. Meena)', '');
      f.text('email', 'Email', (Auth.session() || {}).email || '', 'email');
      f.text('pw', 'Password' + (create ? ' (at least 10 characters)' : ''), '', 'password');
      btn.textContent = create ? 'Create account' : 'Sign in';
      sw.textContent = create ? 'I already have an account: sign in' : 'New here? Create an account';
    };
    const btn = h('button.btn', { vars: { '--bc': 'var(--teal)' }, onclick: async () => {
      err.textContent = '';
      const email = f.get('email'), pw = f.get('pw'), name = f.get('name');
      if (!email || !pw) { err.textContent = 'Enter your email and password'; return; }
      if (create && !name) { err.textContent = 'Enter your name'; return; }
      btn.disabled = true;
      try {
        const msg = await Auth.signIn(email, pw, name, create);
        if (msg) { err.textContent = msg; create = false; draw(); }
        else { await Sync.run(); render(); }
      } catch (e) { err.textContent = e.message; }
      finally { btn.disabled = false; }
    } });
    const sw = h('button.link', { onclick: () => { create = !create; draw(); } });
    const forgot = h('button.link', { onclick: async () => {
      const email = f.get('email');
      if (!email) { err.textContent = 'Type your email first'; return; }
      try { await Auth.reset(email); toast('Password reset email sent to ' + email); } catch (e) { err.textContent = e.message; }
    } }, 'Forgot password?');
    draw();
    page('TVMCHMED', 'Sign in to continue', [
      h('div.card.hero', { style: { textAlign: 'center' } },
        h('img', { src: 'logo.png', alt: '', style: { width: '84px', height: '84px', borderRadius: '20px', background: '#fff' } }),
        h('div', { style: { fontSize: '22px', fontWeight: 800, marginTop: '8px' } }, 'TVMCHMED'),
        h('div.muted', Store.setting('dept', 'Department of Medicine')), h('div.muted', Store.setting('college', 'Tirunelveli Medical College Hospital')),
        h('p', { style: { fontWeight: 600 } }, 'Sign in with the same email and password as the Android app. New here? Create an account, and the admin will approve you.')),
      h('div.card', f.el, err, h('div', { style: { marginTop: '14px' } }, btn), h('div.row', sw, h('div.grow'), forgot))
    ], { tab: false });
  }

  function waiting() {
    const blocked = Auth.role() === 'blocked';
    page('TVMCHMED', (Auth.session() || {}).email, [
      h('div.card',
        h('div.title', blocked ? 'Removed from the app' : 'Waiting for approval'),
        h('p.muted', blocked ? 'The admin has removed your access. Records from the department were deleted from this device.'
          : 'Your account is created. The admin, the HOD or the Medical Registrar approves you in Shared database > Members. Then come back here.'),
        h('div.btns',
          h('button.btn', { onclick: async () => { try { const s = Auth.session(); s.checked = 0; await Auth.join(''); } catch (e) { toast(e.message); } render(); } }, 'Check again'),
          h('button.btn.out', { onclick: async () => { await Auth.signOut(); render(); } }, 'Sign out')))
    ], { tab: false });
  }

  async function firstSync() {
    page('TVMCHMED', 'Getting the department’s records', [h('div.card', h('div.title', 'Downloading records…'),
      h('p.muted', 'This happens once on this device. Keep the app open.'), h('p.muted', Sync.lastError ? 'Last try: ' + Sync.lastError : ''),
      h('button.btn.out', { onclick: () => Sync.run().then(() => render()) }, 'Try again'))], { tab: false });
    await Sync.run();
    if (Store.kv('last_seq', 0)) render();
  }

  // ---------- PIN lock ----------
  function lockScreen() {
    const setting = !Lock.hasPin();
    let first = null, pin = '';
    const head = h('h2'), dots = h('div.dots'), note = h('div.note');
    const show = () => {
      head.textContent = setting ? (first == null ? 'Choose an app PIN of 4 to 8 digits' : 'Type the same PIN again') : 'Enter your PIN';
      dots.textContent = pin.length ? '●'.repeat(pin.length) : '○○○○';
    };
    const submit = async () => {
      const p = pin; pin = '';
      if (setting) {
        if (first == null) {
          if (!/^\d{4,8}$/.test(p)) { note.textContent = 'Use 4 to 8 digits.'; return show(); }
          first = p; note.textContent = ''; return show();
        }
        if (first !== p) { first = null; note.textContent = 'The two PINs did not match. Choose again.'; return show(); }
        await Lock.setPin(p);
        toast('App PIN set');
        return render();
      }
      if (await Lock.check(p)) return render();
      const left = Lock.triesLeft();
      if (left <= 0) {
        await Auth.signOut();
        toast('Too many wrong PINs. Signed out: sign in again, then choose a new PIN.');
        return render();
      }
      note.textContent = 'Wrong PIN. ' + left + (left === 1 ? ' try' : ' tries') + ' left before this device is signed out.';
      show();
    };
    const key = k => () => {
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (k === 'OK') return submit();
      else if (pin.length < 8) { pin += k; note.textContent = ''; }
      show();
    };
    app.innerHTML = '';
    app.appendChild(h('div.lock',
      h('img', { src: 'logo.png', alt: '' }), head,
      setting ? h('p', { style: { textAlign: 'center', opacity: .9, margin: '0', fontSize: '14px' } }, 'If this phone is lost, no one can open the department’s records without this PIN. It stays on this device only.') : null,
      dots, note,
      h('div.pad', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map(k => h('button' + (k === 'OK' ? '.ok' : ''), { onclick: key(k) }, k))),
      setting ? null : h('button.link', { onclick: () => confirmBox('Forgot PIN?', 'This device will be signed out. Sign in again with your email and password, then choose a new PIN. Records already shared online are safe.', 'Sign out', async () => { await Auth.signOut(); render(); }) }, 'Forgot PIN?')));
    show();
  }

  // ---------- home ----------
  function home() {
    const day = D.admitDay(), unit = Dept.todaysUnit();
    const s = Auth.session() || {};
    const alerts = Store.where('alerts', a => a.active === '1' && nz(a.until) > D.stamp()).sort((a, b) => nz(b.posted_at).localeCompare(nz(a.posted_at)));
    const dap = Store.where('dap', r => r.date === day).sort((a, b) => Number(b.id) - Number(a.id))[0];
    const admits = Store.where('events', e => e.type === 'ADMIT' && inDay(e, day)).length;
    const total = Store.where('patients', p => p.status === 'IN' && p.location !== 'KDP').length;
    const notices = Store.where('notices', n => !n.until || n.until >= D.today()).length;
    const tile = (label, glyph, color, href, n) => h('button.tile', { vars: { '--tc': color }, onclick: () => go(href) }, h('span.ic', glyph), label, n != null ? h('span.n', n) : null);
    page('TVMCHMED', Store.setting('dept', 'Department of Medicine'), [
      alerts.map(a => h('div.card.alert', h('div', { style: { fontWeight: 800 } }, '⚠ URGENT FROM THE HOD'), h('div', a.message), h('div.small', { style: { opacity: .85 } }, a.posted_by || ''))),
      h('div.card.hero',
        h('div.row', h('img', { src: 'logo.png', alt: '', style: { width: '54px', height: '54px', borderRadius: '14px', background: '#fff' } }),
          h('div.grow', h('div', { style: { fontWeight: 800, fontSize: '18px' } }, 'Hello, ' + (s.name || 'Doctor')),
            h('div.muted', SC.roleLabels[SC.roles.indexOf(Auth.role())] || Auth.role()))),
        h('div.muted', { style: { marginTop: '8px' } }, 'HOD: ' + Store.setting('hod', 'Prof. Dr. Rathnakumar MD'))),
      h('div.card.tap', { onclick: () => go('#/ward/' + unit), style: { borderLeft: '6px solid ' + Dept.color(unit) } },
        h('div.small', { style: { color: Dept.color(unit), fontWeight: 800, letterSpacing: '.05em' } }, 'ADMISSION DAY · 7:30 AM TO 7:30 AM'),
        h('div.row', h('div.grow', h('div', { style: { fontSize: '22px', fontWeight: 800 } }, unit + ' unit'), h('div.muted', D.nice(day) + ' · ' + D.DAYS[D.dow(day)])),
          h('span.badge', { vars: { '--pc': Dept.color(unit) } }, admits)), h('div.muted.small', admits + ' admitted so far')),
      h('div.card', { style: { background: 'linear-gradient(135deg,#1E40AF,#172554)', color: '#fff' } },
        h('div.small', { style: { color: '#FBBF24', fontWeight: 800, letterSpacing: '.05em' } }, '★ TODAY’S DAP · 24-HOUR DUTY'),
        h('div', { style: { fontSize: '19px', fontWeight: 700, marginTop: '4px' } }, dap && dap.dap_name ? dap.dap_name : 'Not entered yet')),
      h('div.btns', { style: { margin: '4px 12px' } }, h('button.btn', { onclick: () => go('#/admit/TRIAGE/' + unit) }, '+  Admit a patient')),
      heading('Department'),
      h('div.tiles',
        tile('Wards', '🛏', '#2563EB', '#/wards', total + ' in'),
        tile('Patients', '⌕', '#0D9488', '#/search'),
        tile('Triage', '✚', Dept.color('TRIAGE'), '#/ward/TRIAGE', Dept.inpatients('TRIAGE').length + ' in'),
        tile('IMCU', '♥', Dept.color('IMCU'), '#/ward/IMCU', Dept.inpatients('IMCU').length + ' in'),
        tile('Notices', '📌', '#D97706', '#/notices', notices),
        tile('Phone book', '☎', '#059669', '#/phone'),
        tile('Discharged', '✓', '#334155', '#/recent'),
        tile('Me', '☺', '#7C3AED', '#/account'),
        h('button.tile', { vars: { '--tc': '#46178F' }, onclick: () => { location.href = 'quiz.html'; } }, h('span.ic', '🎮'), 'Live quiz')),
      heading('Ward census'),
      h('div.card', SC.allLocs.map(l => {
        const n = Dept.inpatients(l).length;
        return n ? h('div.pt', { onclick: () => go('#/ward/' + l) }, h('span.dot', { style: { width: '12px', height: '12px', borderRadius: '6px', background: Dept.color(l) } }),
          h('div.grow', Dept.unitName(l)), h('span.badge', { vars: { '--pc': Dept.color(l) } }, n)) : null;
      }), h('div.kv', h('b', 'Total at TVMCH'), h('span', { style: { fontWeight: 800 } }, total)))
    ], { tab: '' });
  }

  /** In the 7:30 AM to 7:30 AM window of an admission day. */
  function inDay(e, day) {
    const t = nz(e.time), next = D.addDays(day, 1);
    return (e.date === day && (t === '' || t >= '07:30')) || (e.date === next && t !== '' && t < '07:30');
  }

  // ---------- wards ----------
  function wards() {
    page('Wards', Store.where('patients', p => p.status === 'IN').length + ' inpatients', [
      heading('Units'),
      h('div.card', SC.wardUnits.map(wardRow)),
      heading('Special wards'),
      h('div.card', Dept.SPECIAL.concat(['KDP']).map(wardRow))
    ], { tab: 'wards' });
  }

  function wardRow(l) {
    const ps = Dept.inpatients(l);
    const m = ps.filter(p => p.sex !== 'F').length, f = ps.length - m;
    const day = Dept.admitDayOf(l);
    return h('div.pt', { onclick: () => go('#/ward/' + l) },
      h('div.av', { vars: { '--pc': Dept.color(l) } }, Dept.shortName(l).slice(0, 2)),
      h('div.grow', h('div.nm', Dept.unitName(l)), h('div.muted.small', (day ? D.DAYS[day] + ' admissions · ' : '') + 'Male ' + m + ' · Female ' + f)),
      h('span.badge', { vars: { '--pc': Dept.color(l) } }, ps.length));
  }

  function ward(code) {
    const c = Dept.color(code);
    const ps = Dept.inpatients(code).sort(byBed);
    const unit = Dept.isWardUnit(code);
    const admitTo = unit ? 'TRIAGE' : code, parent = unit ? code : Dept.todaysUnit();
    // the TAEI ward is another department's: medicine admits no one there, it receives its patients into CCB, triage or (rarely) IMCU
    const taei = code === 'TAEI';
    const list = (title, arr) => arr.length ? [heading(title + ' · ' + arr.length, c), h('div.card', arr.map(patientRow))] : null;
    const away = unit ? Store.where('patients', p => p.status === 'IN' && p.home_unit === code && p.location !== code && Dept.isSpecial(p.location)) : [];
    page(Dept.unitName(code), ps.length + ' in the ward' + (Dept.admitDayOf(code) ? ' · admits ' + D.DAYS[Dept.admitDayOf(code)] : ''), [
      taei ? h('div.card', h('p.muted', { style: { marginTop: 0 } }, 'Medicine does not admit patients in the TAEI ward (another department). Receive its patients into the Critical Care Block or the triage ward, rarely IMCU, under ' + parent + ' today.'),
        h('div.btns', [['CCB', 'To CCB'], ['TRIAGE', 'To triage'], ['IMCU', 'To IMCU (rarely)']].map(([w, t], i) =>
          h(i ? 'button.btn.out' : 'button.btn', { vars: { '--bc': Dept.color(w) }, onclick: () => go('#/admit/' + w + '/' + parent + '/taei') }, t))))
      : h('div.btns', { style: { margin: '4px 12px' } }, h('button.btn', { vars: { '--bc': c }, onclick: () => go('#/admit/' + admitTo + '/' + parent) },
        unit ? '+ Admit to triage under ' + code : '+ Admit to ' + Dept.shortName(code))),
      ps.length || taei ? null : h('div.card', h('p.muted', 'No patients in this ward now.')),
      Dept.isSpecial(code) ? SC.wardUnits.map(u => list('Under ' + u, ps.filter(p => p.home_unit === u))).concat([list('Other', ps.filter(p => !SC.wardUnits.includes(p.home_unit)))])
        : [list('Male ward', ps.filter(p => p.sex !== 'F')), list('Female ward', ps.filter(p => p.sex === 'F'))],
      away.length ? [heading(code + ' patients in other wards · ' + away.length, c), h('div.card', away.map(patientRow))] : null
    ], { tab: 'wards', back: true, color: c });
  }

  const byBed = (a, b) => nz(a.bed).localeCompare(nz(b.bed), undefined, { numeric: true }) || nz(a.name).localeCompare(nz(b.name));

  function patientRow(p) {
    const c = Dept.color(p.location);
    const st = p.status === 'IN' ? Dept.where(p) + (p.bed ? ' · bed ' + p.bed : '') : (p.status === 'DIED' ? 'Died ' : 'Discharged ') + D.nice(p.outcome_date);
    return h('div.pt', { onclick: () => go('#/patient/' + p.id) },
      h('div.av', { vars: { '--pc': p.status === 'IN' ? c : '#94A3B8' } }, nz(p.name).trim().charAt(0).toUpperCase() || '?'),
      h('div.grow', h('div.nm', p.name), h('div.muted.small', [p.age ? p.age + ' y' : '', p.sex === 'F' ? 'F' : 'M', p.ip_no ? 'IP ' + p.ip_no : '', st].filter(Boolean).join(' · ')),
        p.diagnosis ? h('div.small', { style: { color: '#334155' } }, p.diagnosis) : null),
      p.mlc === 'MLC' ? h('span.pill', { vars: { '--pc': 'var(--red)' } }, 'MLC') : null);
  }

  // ---------- search / recent ----------
  function search() {
    const q = h('input.in', { placeholder: 'Name, IP number or diagnosis', type: 'search', oninput: () => draw() });
    const out = h('div.card');
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      out.innerHTML = '';
      let ps = Store.all('patients');
      if (s) ps = ps.filter(p => (nz(p.name) + ' ' + nz(p.ip_no) + ' ' + nz(p.diagnosis) + ' ' + nz(p.phone)).toLowerCase().includes(s));
      else ps = ps.filter(p => p.status === 'IN');
      ps.sort((a, b) => (a.status === 'IN' ? 0 : 1) - (b.status === 'IN' ? 0 : 1) || nz(b.admit_date).localeCompare(nz(a.admit_date)));
      ps.slice(0, 150).forEach(p => out.appendChild(patientRow(p)));
      if (!ps.length) out.appendChild(h('p.muted', 'No patients found.'));
    };
    page('Patients', 'Search all patients', [h('div.card', q), out], { tab: 'search' });
    draw();
  }

  function recent() {
    const since = D.addDays(D.today(), -14);
    const ps = Store.where('patients', p => p.status !== 'IN' && nz(p.outcome_date) >= since).sort((a, b) => nz(b.outcome_date).localeCompare(nz(a.outcome_date)));
    page('Discharges and deaths', 'Last 14 days · ' + ps.length, [h('div.card', ps.length ? ps.map(patientRow) : h('p.muted', 'None in the last 14 days.'))], { tab: '', back: true });
  }

  // ---------- patient ----------
  function patient(id) {
    const p = Store.get('patients', id);
    if (!p) return page('Patient', '', [h('div.card', h('p.muted', 'This record is not on this device (it may have been deleted).'))], { back: true });
    const c = Dept.color(p.location), inn = p.status === 'IN';
    const cs = CaseSheetWeb.load(id);
    const filled = SC.sections.filter(s => CaseSheetWeb.filled(cs, s)).length;
    const state = p.status === 'DIED' ? 'Died on ' + D.nice(p.outcome_date) : p.status === 'DISCHARGED' ? 'Discharged on ' + D.nice(p.outcome_date)
      : 'Now in ' + Dept.where(p) + (p.bed ? ', bed ' + p.bed : '');
    let sub = (p.age ? p.age + ' y, ' : '') + (p.sex === 'F' ? 'Female' : 'Male') + (p.ip_no ? ' · IP ' + p.ip_no : '');
    if (p.mlc) sub += ' · ' + p.mlc + (p.mlc === 'MLC' && p.ar_no ? ' (AR ' + p.ar_no + ')' : '');
    const moves = inn ? Dept.quickMoves(p) : [];
    page(p.name, sub, [
      h('div.card.hero', { style: { background: 'linear-gradient(135deg,' + c + ', color-mix(in srgb,' + c + ' 55%, #0B2E5C))' } },
        h('div', { style: { fontSize: '17px', fontWeight: 700 } }, state),
        h('div.muted', 'Admitted ' + D.nice(p.admit_date) + (p.diagnosis ? ' · ' + p.diagnosis : '')),
        h('div.btns', h('button.btn.glass', { onclick: () => go('#/cs/' + id) }, filled ? 'Case sheet (' + filled + ' filled)' : 'Case sheet')),
        cs.wb_name ? h('div.muted.small', { style: { marginTop: '8px' } }, 'Case written by ' + cs.wb_name + (cs.wb_year ? ' (' + cs.wb_year + ')' : '')) : null),
      inn ? [heading('Move or close', c), h('div.card',
        moves.length ? h('div.btns', { style: { marginTop: 0 } }, moves.map(w => h('button.btn', { vars: { '--bc': Dept.color(w) }, onclick: () => transfer(p, w) },
          (p.convict === '1' && w === Dept.rotationUnit() ? 'To convict ward (' + w + ')' : Dept.isWardUnit(w) ? 'To ' + w + ' ward' : 'To ' + Dept.shortName(w))))) : null,
        h('div.btns', h('button.btn.out', { onclick: () => transfer(p, null) }, 'Transfer to another ward…')),
        h('div.btns', h('button.btn', { vars: { '--bc': 'var(--green)' }, onclick: () => discharge(p) }, 'Discharge'),
          h('button.btn', { vars: { '--bc': 'var(--slate)' }, onclick: () => death(p) }, 'Record death')))] : null,
      heading('Details'),
      h('div.card', kv('Parent unit', Dept.unitName(p.home_unit)), kv('Admitted on', D.nice(p.admit_date)), kv('Diagnosis', p.diagnosis),
        kv('Admission group', p.category ? p.category + ' (listed separately)' : ''), kv('Bed', p.bed),
        p.dengue === '1' ? kv('Dengue', 'Positive' + (p.dengue_test ? ' (' + p.dengue_test + ')' : '') + (p.dengue_grade ? ' · ' + p.dengue_grade : '')) : null,
        kv('Toxicology', p.tox_kind ? p.tox_kind + (p.tox_agent ? ' · ' + p.tox_agent : '') : ''),
        kv('Phone', p.phone), kv('Address', p.address),
        kv('CMCHIS', p.cmchis === '1' ? 'Yes' + (p.cmchis_no ? ' (' + p.cmchis_no + ')' : '') : 'No'),
        inn ? null : kv(p.status === 'DIED' ? 'Cause / notes' : 'Discharge notes', p.outcome_note),
        p.phone ? h('div.btns', h('a.btn.out', { href: 'tel:' + p.phone, vars: { '--bc': 'var(--green)' } }, 'Call ' + p.phone)) : null),
      heading('Timeline', '#7C3AED'),
      h('div.card', Dept.events(id).map(e => h('div.pt', { style: { cursor: 'default' } },
        h('span', { style: { width: '12px', height: '12px', borderRadius: '6px', flex: 'none', background: e.type === 'ADMIT' ? '#1D4E89' : e.type === 'DISCHARGE' ? '#059669' : e.type === 'DEATH' ? '#334155' : Dept.color(e.to_loc) } }),
        h('div.grow', h('div.nm', Dept.eventLabel(e)), h('div.muted.small', D.nice(e.date) + (e.time ? '  ' + e.time : '') + (e.note ? ' · ' + e.note : '')))))),
      h('div.card', h('div.btns', { style: { marginTop: 0 } },
        h('button.btn.out', { onclick: () => go('#/edit/' + id) }, 'Edit details'),
        h('button.btn.out', { vars: { '--bc': 'var(--amber)' }, onclick: () => undo(p) }, 'Undo last step')))
    ], { back: true, color: c, action: ['Edit', () => go('#/edit/' + id)], tab: 'search' });
  }

  function when(f) { f.date('date', 'Date', D.today()); f.time('time', 'Time', D.now()); return f; }

  function transfer(p, to) {
    const f = new Form();
    if (!to) {
      const opts = Dept.nextWards(p.location, p.home_unit).filter(l => l !== p.location);
      const cw = Dept.rotationUnit();
      if (p.convict === '1' && !opts.includes(cw) && cw !== p.location) opts.unshift(cw);
      f.choice('to', 'Transfer to', opts, opts.map(Dept.unitName), opts[0]);
    }
    when(f);
    f.text('bed', 'New bed number', '');
    f.multi('note', 'Reason / notes', '');
    sheet(to ? 'Transfer to ' + Dept.unitName(to) : 'Transfer ' + p.name, f.el, 'Transfer', async () => {
      const dest = to || f.get('to');
      if (!dest) { toast('Choose the ward'); return false; }
      await Dept.addEvent(p.id, f.get('date'), f.get('time'), 'TRANSFER', p.location, dest, f.get('note'));
      await Store.update('patients', p.id, { bed: f.get('bed') });
      render(true);
    });
  }

  function discharge(p) {
    const f = when(new Form());
    f.choice('type', 'Type of discharge', SC.dischargeTypes, null, SC.dischargeTypes[0], 'var(--green)');
    const cs = CaseSheetWeb.load(p.id);
    f.multi('dx', 'Final diagnosis (needed to discharge)', cs.final_dx || CaseSheetWeb.withNewDiagnoses(nz(p.diagnosis), cs));
    diagnosisPicker(f, 'dx');
    f.multi('note', 'Advice / notes', '');
    sheet('Discharge ' + p.name, f.el, 'Discharge', async () => {
      const dx = f.get('dx');
      if (!dx) { toast('Enter the final diagnosis before discharge'); return false; }
      if (dx !== nz(cs.final_dx) && Dept.canEdit(p)) { cs.final_dx = dx; await CaseSheetWeb.save(p.id, cs); }
      const note = f.get('type') + '. Final diagnosis: ' + dx + (f.get('note') ? '. ' + f.get('note') : '');
      await Dept.addEvent(p.id, f.get('date'), f.get('time'), 'DISCHARGE', p.location, '', note);
      render(true);
    }, { color: 'var(--green)' });
  }

  function death(p) {
    const f = when(new Form());
    f.choice('place', 'Place of death (for the census)', SC.deathPlaces, null, Dept.defaultDeathPlace(p), 'var(--slate)');
    f.multi('note', 'Cause of death (type, or choose from the list)', '');
    diagnosisPicker(f, 'note');
    sheet('Record death of ' + p.name, f.el, 'Save', async () => {
      if (!f.get('note')) { toast('Enter the cause of death'); return false; }
      await Dept.addEvent(p.id, f.get('date'), f.get('time'), 'DEATH', p.location, '', f.get('note'));
      await Store.update('patients', p.id, { death_place: f.get('place') });
      render(true);
    }, { color: 'var(--slate)' });
  }

  function undo(p) {
    const ev = Dept.events(p.id).filter(e => e.type !== 'ADMIT');
    if (!ev.length) return toast('Nothing to undo; only the admission is recorded.');
    const last = ev[ev.length - 1];
    confirmBox('Undo last step?', 'Remove: ' + Dept.eventLabel(last) + ' on ' + D.nice(last.date), 'Undo', async () => { await Dept.undoLast(p.id); render(true); }, 'var(--amber)');
  }

  // ---------- admission form ----------
  function admitForm(admitTo, parent, from) {
    const taei = from === 'taei' || admitTo === 'TAEI';
    patientForm(null, admitTo && admitTo !== 'TAEI' ? admitTo : 'TRIAGE', parent || Dept.todaysUnit(), null, taei);
  }
  function editForm(id) {
    const p = Store.get('patients', id);
    if (!p) return go('#/');
    const adm = Dept.events(id).find(e => e.type === 'ADMIT');
    patientForm(p, adm ? adm.to_loc : p.location, adm ? adm.from_loc : p.home_unit, adm);
  }

  function patientForm(p, admitTo, parent, adm, taei) {
    const v = (k, d) => (p && p[k] != null ? p[k] : d == null ? '' : d);
    const f = new Form();
    f.heading('Patient');
    f.text('name', 'Name *', v('name'));
    f.text('ip_no', 'IP number', v('ip_no'));
    f.beginRow(); f.text('age', 'Age (years)', v('age'), 'number'); f.choice('sex', 'Sex', ['M', 'F'], ['Male', 'Female'], v('sex', 'M')); f.endRow();
    f.text('phone', 'Phone', v('phone'), 'tel');
    f.multi('address', 'Address', v('address'));
    f.multi('diagnosis', 'Diagnosis (type, or choose from the list)', v('diagnosis'));
    diagnosisPicker(f, 'diagnosis');
    f.choice('category', 'Admission group (hemophilia and stroke are listed separately)', SC.categories, SC.categoryLabels, v('category'));
    f.heading('For the daily census');
    f.choice('source', 'Came to medicine from', SC.sources, SC.sourceLabels, v('source', taei ? 'TEAI' : ''));
    f.choice('toxic', 'Toxicology', ['Non-toxic', 'Toxic'], null, v('tox_kind') ? 'Toxic' : 'Non-toxic');
    f.choice('tox_kind', 'Toxic: type', SC.toxKinds, null, v('tox_kind'));
    f.text('tox_agent', 'Poison / agent (e.g. paraquat, cypermethrin)', v('tox_agent'));
    f.beginRow(); f.choice('teai_reg', 'Registered in TEAI', ['Yes', 'No'], null, v('teai_reg')); f.choice('teai_upd', 'Updated in TEAI', ['Yes', 'No'], null, v('teai_upd')); f.endRow();
    f.choice('sb_snake', 'Snake', SC.snakes, null, v('sb_snake'));
    f.choice('sb_part', 'Bite site', ['Hand', 'Leg', 'Body'], null, v('sb_part'));
    f.choice('sb_daynight', 'Bitten in the', ['Day', 'Night'], null, v('sb_daynight'));
    f.choice('sb_delay', 'Bite to hospital', ['Under 4 h', '4 to 12 h', '12 to 24 h', 'Over 24 h'], null, v('sb_delay'));
    f.text('sb_asv', 'ASV vials given', v('sb_asv'), 'number');
    f.choice('st_type', 'Stroke type', SC.strokeTypes, null, v('st_type'));
    f.choice('st_window', 'Onset to hospital', SC.strokeWindows, null, v('st_window'));
    f.check('st_ct', 'CT brain done', v('st_ct') === '1');
    f.check('st_mri', 'MRI brain done', v('st_mri') === '1');
    f.choice('st_lysis', 'Thrombolysed', ['Yes', 'No'], null, v('st_lysis'));
    f.check('convict', 'Convict / prisoner', v('convict') === '1');
    f.check('staff_pt', 'Student or staff of the college', v('staff_pt') === '1');
    f.check('id_ward', 'In the ID (infectious diseases) ward', v('id_ward') === '1');
    f.choice('id_disease', 'ID ward: disease', SC.idDiseases, null, v('id_disease'));
    f.heading('Admission');
    f.choice('mlc', 'Medico-legal case *', ['NMLC', 'MLC'], null, v('mlc'), 'var(--red)');
    f.text('ar_no', 'AR number (accident register)', v('ar_no'));
    if (Dept.isSpecial(admitTo)) f.choice('parent', 'Admitting unit (the case stays under this unit)', SC.wardUnits, null, parent);
    f.date('date', 'Date of admission', adm ? adm.date : D.today());
    f.time('time', 'Time', adm ? adm.time : D.now());
    f.text('bed', 'Bed number', v('bed'));
    f.check('cmchis', 'Covered under CMCHIS', v('cmchis') === '1');
    f.text('cmchis_no', 'CMCHIS / insurance ID', v('cmchis_no'));
    const vis = () => {
      const toxic = f.get('toxic') === 'Toxic', snake = toxic && f.get('tox_kind') === 'Snake bite';
      const stroke = f.get('category') === 'Stroke' || Dept.categoryIn(f.get('diagnosis')) === 'Stroke';
      f.show('tox_kind', toxic);
      ['tox_agent', 'teai_reg', 'teai_upd'].forEach(k => f.show(k, toxic));
      ['sb_snake', 'sb_part', 'sb_daynight', 'sb_delay', 'sb_asv'].forEach(k => f.show(k, snake));
      ['st_type', 'st_window', 'st_ct', 'st_mri', 'st_lysis'].forEach(k => f.show(k, stroke));
      f.show('id_disease', f.get('id_ward') === '1');
      f.show('ar_no', f.get('mlc') === 'MLC');
    };
    f.onChange(vis);
    vis();
    const err = h('div.err');
    const save = h('button.btn', { onclick: async () => {
      err.textContent = '';
      if (!f.get('name')) { err.textContent = 'Enter the patient’s name'; return; }
      if (!f.get('mlc')) { err.textContent = 'Choose MLC or NMLC'; return; }
      if (f.get('toxic') === 'Toxic' && !f.get('tox_kind')) { err.textContent = 'Choose the type of toxic case'; return; }
      const cv = {};
      for (const k of ['name', 'ip_no', 'age', 'sex', 'phone', 'address', 'diagnosis', 'bed', 'cmchis', 'cmchis_no', 'category', 'mlc', 'ar_no',
        'source', 'tox_kind', 'tox_agent', 'teai_reg', 'teai_upd', 'sb_part', 'sb_daynight', 'sb_delay', 'sb_asv', 'st_type', 'st_window', 'st_lysis']) cv[k] = f.get(k);
      for (const k of ['st_ct', 'st_mri', 'convict', 'staff_pt', 'id_ward']) cv[k] = f.get(k) === '1' ? '1' : '';
      cv.cmchis = f.get('cmchis') === '1' ? '1' : '0';
      if (f.get('toxic') !== 'Toxic') cv.tox_kind = '';
      cv.id_disease = cv.id_ward === '1' ? f.get('id_disease') : '';
      if (cv.tox_kind === 'Snake bite') cv.sb_snake = f.get('sb_snake') || 'Unknown';
      if (!cv.tox_kind) { cv.tox_agent = ''; cv.teai_reg = ''; cv.teai_upd = ''; }
      if (cv.mlc !== 'MLC') cv.ar_no = '';
      if (!cv.category) cv.category = Dept.categoryIn(cv.diagnosis);
      const par = f.has('parent') ? f.get('parent') : parent;
      save.disabled = true;
      try {
        if (!p) {
          if (cv.ip_no) {
            const dup = Store.where('patients', x => x.ip_no === cv.ip_no && x.status === 'IN')[0];
            if (dup) toast('Note: IP ' + cv.ip_no + ' is also in use for ' + dup.name);
          }
          const nid = await Dept.admit(cv, admitTo, par, f.get('date'), f.get('time'));
          location.replace('#/patient/' + nid);
        } else {
          await Dept.editPatient(p.id, cv, admitTo, par, f.get('date'), f.get('time'));
          history.back();
        }
      } catch (e) { err.textContent = e.message; save.disabled = false; }
    } }, p ? 'Save changes' : 'Admit');
    page(p ? 'Edit ' + p.name : taei ? 'Receive from TAEI ward' : 'Admit a patient', p ? Dept.unitName(admitTo) : 'To ' + Dept.unitName(admitTo) + (Dept.isSpecial(admitTo) ? ' under ' + parent : ''),
      [h('div.card', f.el, err, h('div', { style: { marginTop: '14px' } }, save))], { back: true, tab: false });
  }

  // ---------- notices ----------
  function notices() {
    const today = D.today();
    const all = Store.all('notices').sort((a, b) => (Number(b.pinned || 0) - Number(a.pinned || 0)) || nz(b.date).localeCompare(nz(a.date)) || Number(b.id) - Number(a.id));
    const cur = all.filter(n => !n.until || n.until >= today), old = all.filter(n => n.until && n.until < today).slice(0, 30);
    const card = n => h('div.card' + (n.image ? '.tap' : ''), { onclick: n.image ? () => openFile(n.image, n.title) : null },
      h('div.row', h('span.pill', { vars: { '--pc': 'var(--amber)' } }, n.category || 'General'), n.pinned === '1' ? h('span.pill', '📌 Pinned') : null, h('div.grow'), h('span.muted.small', D.nice(n.date))),
      h('div.title', { style: { marginTop: '6px' } }, n.title), n.body ? h('div', { style: { whiteSpace: 'pre-wrap' } }, n.body) : null,
      n.until ? h('div.muted.small', 'Valid till ' + D.nice(n.until)) : null, n.image ? h('div.link', 'Tap to open the attached photo') : null);
    const canPost = Auth.isAdmin() || ['professor', 'faculty'].includes(Auth.role());
    page('Notice board', cur.length + ' current', [
      cur.length ? cur.map(card) : h('div.card', h('p.muted', 'No current notices.')),
      old.length ? [heading('Older'), old.map(card)] : null
    ], { tab: 'notices', action: canPost ? ['+ Post', noticeForm] : null });
  }

  function noticeForm() {
    const f = new Form();
    f.choice('category', 'Type', SC.noticeCats, null, SC.noticeCats[0], 'var(--amber)');
    f.text('title', 'Title *', '');
    f.multi('body', 'Details (who, when, where)', '');
    f.date('date', 'Date of notice', D.today());
    f.date('until', 'Valid till (optional)', '');
    f.check('pinned', 'Pin to the top of the board', false);
    sheet('Post a notice', f.el, 'Post', async () => {
      if (!f.get('title')) { toast('Enter a title'); return false; }
      await Store.put('notices', { category: f.get('category'), title: f.get('title'), body: f.get('body'), date: f.get('date'), until: f.get('until'), pinned: f.get('pinned') === '1' ? '1' : '0', image: '' });
      render(true);
    }, { color: 'var(--amber)' });
  }

  /** Opens a shared photo or file (notice images, etc.) from the department's storage. */
  async function openFile(rel, title) {
    const w = window.open('', '_blank');
    try {
      const tok = await TVM.token();
      const r = await fetch(CONFIG.url + '/storage/v1/object/files/' + rel.split('/').map(encodeURIComponent).join('/'), { headers: { apikey: CONFIG.key, Authorization: 'Bearer ' + tok } });
      if (!r.ok) throw new Error('Could not open the file (' + r.status + ')');
      const url = URL.createObjectURL(await r.blob());
      if (w) w.location = url; else location.href = url;
    } catch (e) { if (w) w.close(); toast(e.message); }
  }

  // ---------- phone book ----------
  function phone() {
    const q = h('input.in', { placeholder: 'Search name, designation or unit', type: 'search', oninput: () => draw() });
    const out = h('div');
    const people = [];
    const hodPhone = Store.setting('hod_phone', '');
    if (hodPhone) people.push({ name: Store.setting('hod', 'HOD'), sub: 'Head of Department', phone: hodPhone, cat: 'Faculty' });
    for (const s of Store.where('staff', s => !nz(s.approval) && s.phone)) {
      const r = nz(s.role);
      const cat = r.startsWith('MBBS') ? 'MBBS students' : ['Postgraduate', 'CRMI'].includes(r) ? 'PGs and CRMIs' : ['Professor', 'Associate Professor', 'Assistant Professor', 'HOD'].includes(r) ? 'Faculty' : 'Workers';
      people.push({ name: s.name, sub: r + (s.unit ? ' · ' + s.unit : ''), phone: s.phone, cat });
    }
    for (const c of Store.all('contacts')) people.push({ name: c.name, sub: [c.designation, c.place].filter(Boolean).join(' · '), phone: c.phone, phone2: c.phone2, cat: c.category === 'ADMIN' ? 'Administration' : c.category === 'WORKER' ? 'Workers' : 'Others' });
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      out.innerHTML = '';
      for (const cat of ['Faculty', 'Administration', 'PGs and CRMIs', 'Workers', 'MBBS students', 'Others']) {
        const list = people.filter(p => p.cat === cat && (!s || (p.name + ' ' + p.sub).toLowerCase().includes(s))).sort((a, b) => nz(a.name).localeCompare(nz(b.name)));
        if (!list.length) continue;
        out.appendChild(heading(cat + ' · ' + list.length, '#059669'));
        out.appendChild(h('div.card', list.map(p => h('div.pt', { style: { cursor: 'default' } },
          h('div.grow', h('div.nm', p.name), h('div.muted.small', p.sub)),
          h('a.pill', { href: 'tel:' + p.phone, vars: { '--pc': 'var(--green)' }, style: { textDecoration: 'none', fontSize: '14px', padding: '7px 12px' } }, '☎ ' + p.phone),
          p.phone2 ? h('a.pill', { href: 'tel:' + p.phone2, vars: { '--pc': 'var(--green)' }, style: { textDecoration: 'none' } }, '☎ 2') : null))));
      }
      if (!out.children.length) out.appendChild(h('div.card', h('p.muted', 'No numbers found.')));
    };
    page('Phone book', people.length + ' numbers', [h('div.card', q), out], { back: true, tab: '' });
    draw();
  }

  // ---------- me / account ----------
  function account() {
    const s = Auth.session() || {};
    const st = Dept.myStaff();
    const after = h('div.bands', [1, 3, 5, 15].map(m => h('button.band' + (Lock.after() === m ? '.on' : ''), { onclick: () => { Lock.setAfter(m); render(true); } }, m + ' min')));
    page('Me', s.email, [
      h('div.card', kv('Name', s.name), kv('Email', s.email), kv('Role', SC.roleLabels[SC.roles.indexOf(Auth.role())] || Auth.role()),
        kv('Staff list entry', st ? st.name + ' (' + nz(st.role) + (st.unit ? ', ' + st.unit : '') + ')' : 'Not linked (the admin can link it)'),
        st ? null : h('p.muted.small', 'Until you are linked to your staff list entry you can read case sheets but not change them.')),
      heading('Sharing'),
      h('div.card', kv('Last synced', Sync.lastSync ? new Date(Sync.lastSync).toLocaleTimeString() : 'Not yet in this session'),
        kv('Waiting to upload', String(Store.pending())), Sync.lastError ? kv('Problem', Sync.lastError) : null,
        h('div.btns', h('button.btn', { vars: { '--bc': 'var(--teal)' }, onclick: async () => { await Sync.run(); toast(Sync.lastError ? Sync.lastError : 'Up to date'); render(true); } }, 'Sync now'))),
      heading('App lock'),
      h('div.card', h('p.muted', 'The app asks for your PIN when it opens and after it has been away for a while, so a lost phone does not show patient records. Five wrong PINs sign this device out.'),
        h('div.small', { style: { fontWeight: 600, margin: '8px 0 6px' } }, 'Lock after the app is away for'), after,
        h('div.btns', h('button.btn.out', { onclick: () => { Lock.clear(); Lock.unlocked = false; render(); } }, 'Change PIN'))),
      heading('Add to Home Screen'),
      h('div.card', h('p', { style: { margin: 0 } }, 'On iPhone or iPad: open this page in Safari, tap the Share button (square with an arrow), then “Add to Home Screen”. The app then opens full screen from its own icon.')),
      h('div.card', h('div.btns', { style: { marginTop: 0 } }, h('button.btn.out', { vars: { '--bc': 'var(--red)' }, onclick: () => confirmBox('Sign out?', Store.pending() ? Store.pending() + ' changes are not uploaded yet and will be lost. Connect to the internet and sync first.' : 'You will need your email and password to sign in again.', 'Sign out', async () => { await Auth.signOut(); render(); }) }, 'Sign out'))),
      h('p.muted.small', { style: { textAlign: 'center' } }, 'Web app ' + CONFIG.version + ' · works with the Android app 7.64')
    ], { tab: 'account' });
  }

  const ROUTES = {
    '': home, wards, ward, patient, search, recent, notices, phone, account,
    admit: admitForm, edit: editForm,
    cs: id => CaseSheetWeb.screen(id, { page, heading, kv, go, render })
  };

  start().catch(e => { app.innerHTML = ''; app.appendChild(h('div.card', h('div.title', 'Could not start'), h('p', e.message), h('p.muted', 'Private browsing can block the app’s storage. Open it in normal Safari.'))); });
})();
