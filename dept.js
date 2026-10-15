/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary: copying, cloning or AI-assisted recreation without written permission is prohibited. See LICENSE.txt. */
// The department's rules, the same as the Android app (Db.java, Dates.java): wards, admission days, admit / transfer / discharge.
(function () {
  'use strict';
  const { Store, Auth } = window.TVM;
  const SC = window.SCHEMA;

  const WARD_UNITS = SC.wardUnits;
  const SPECIAL = ['TAEI', 'TRIAGE', 'STEPDOWN', 'IMCU', 'FEVER', 'CCB', 'IDW', 'GERI', 'RHEUM'];
  const COLORS = {
    M1: '#2563EB', M2: '#0891B2', M3: '#16A34A', M4: '#9333EA', M5: '#DB2777', M6: '#EA580C', M7: '#854D0E', IMCU: '#DC2626', FEVER: '#F59E0B',
    CCB: '#BE123C', KDP: '#0F766E', GERI: '#0369A1', RHEUM: '#7C3AED', TAEI: '#B45309', TRIAGE: '#E11D48', STEPDOWN: '#4F46E5', IDW: '#65A30D'
  };
  const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const D = {
    today: () => iso(new Date()),
    now: () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
    /** The admission day runs 7:30 AM to 7:30 AM next day. */
    admitDay() {
      const d = new Date();
      if (d.getHours() * 60 + d.getMinutes() < 450) d.setDate(d.getDate() - 1);
      return iso(d);
    },
    dow(isoDate) { const d = new Date(isoDate + 'T12:00:00'); return ((d.getDay() + 6) % 7) + 1; },
    nice(s) {
      if (!s) return '';
      const d = new Date(s + 'T12:00:00');
      if (isNaN(d)) return s;
      return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getFullYear();
    },
    addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); },
    stamp() { return D.today() + 'T' + D.now(); },
    DAYS
  };

  const nz = v => (v == null ? '' : String(v));
  const Dept = {
    WARD_UNITS, SPECIAL, COLORS, DAYS,
    color: c => COLORS[c] || '#1D4E89',
    isWardUnit: c => WARD_UNITS.includes(c),
    isSpecial: c => SPECIAL.includes(c),
    unitName: c => !c ? '-' : c === 'DEPT' ? 'Department' : (SC.unitNames[c] || c + ' unit'),
    shortName: c => SC.shortNames[c] || c,
    admitDayOf: c => { const i = WARD_UNITS.indexOf(c); return i < 0 ? 0 : i + 1; },
    todaysUnit: () => WARD_UNITS[D.dow(D.admitDay()) - 1] || 'M1',
    fixedFlow: l => l === 'TAEI' || l === 'TRIAGE' || l === 'STEPDOWN',
    rotationUnit(ym) {
      const a = Store.setting('rotation_anchor', '2026-10:M3');
      try {
        const [base, unit] = a.split(':');
        const [by, bm] = base.split('-').map(Number);
        const now = ym || D.today().slice(0, 7);
        const [y, m] = now.split('-').map(Number);
        const diff = (y - by) * 12 + (m - bm);
        const start = Number(unit.slice(1)) - 1;
        return WARD_UNITS[(((start + diff) % 7) + 7) % 7];
      } catch (e) { return 'M3'; }
    },
    nextWards(loc, home) {
      const out = [];
      const unitWard = Dept.isWardUnit(home) ? home : null;
      if (loc === 'TAEI') out.push('CCB', 'TRIAGE', 'IMCU');   // only cases marked in TAEI by older versions
      else if (loc === 'TRIAGE') out.push('STEPDOWN', 'FEVER', 'IMCU', 'IDW');
      else if (loc === 'STEPDOWN') { if (unitWard) out.push(unitWard); out.push('IMCU', 'CCB'); }
      else {
        if (!Dept.isWardUnit(loc)) { out.push('STEPDOWN'); if (unitWard) out.push(unitWard); }
        for (const w of SC.allLocs) if (w !== loc && !out.includes(w) && w !== 'TAEI') out.push(w);
      }
      return out;
    },
    /** Quick move buttons on the patient page. */
    quickMoves(p) {
      const loc = p.location, home = p.home_unit;
      let next = [];
      if (Dept.fixedFlow(loc)) next = Dept.nextWards(loc, home);
      else if (Dept.isWardUnit(loc)) next = ['IMCU', 'FEVER', 'CCB', 'GERI', 'RHEUM'];
      else { next.push('STEPDOWN'); if (Dept.isWardUnit(home)) next.push(home); }
      const cw = Dept.rotationUnit();
      if (p.convict === '1' && cw !== loc) { next = next.filter(x => x !== cw); next.unshift(cw); }
      return next.filter(x => x !== loc);
    },
    categoryIn(dx) {
      const d = nz(dx).toLowerCase();
      if (/(h(a)?emophilia|factor (viii|ix|8|9) deficiency|von willebrand)/.test(d)) return 'Hemophilia';
      if (/(stroke|\bcva\b|cerebrovascular|cerebral infarct|infarct of brain|\bich\b|intra ?cerebral (h(a)?emorrhage|bleed)|\bgc bleed|ganglio ?capsular|\btia\b|hemiplegi|hemipares|aphasi|thrombolys)/.test(d)) return 'Stroke';
      return '';
    },
    dengueTestIn(dx) {
      const d = nz(dx).toLowerCase();
      if (!d.includes('dengue') || /(negative|neg\b|ruled out|r\/o|\?|suspect|probable)/.test(d)) return null;
      const ns1 = d.includes('ns1'), igm = d.includes('igm');
      if (ns1 && igm) return 'NS1 + IgM';
      if (ns1) return 'NS1';
      if (igm) return 'IgM';
      if (d.includes('igg')) return 'IgG';
      return '';
    },
    patients: (fn) => Store.where('patients', fn),
    inpatients: loc => Store.where('patients', p => p.status === 'IN' && p.location === loc),
    /** The admission first, then by date and time (ids come from each device's own block, so they do not give the order). */
    events: pid => Store.where('events', e => e.patient_id === String(pid)).sort((a, b) =>
      ((a.type === 'ADMIT' ? 0 : 1) - (b.type === 'ADMIT' ? 0 : 1)) || nz(a.date).localeCompare(nz(b.date)) || nz(a.time).localeCompare(nz(b.time)) || Number(a.id) - Number(b.id)),
    eventLabel(e) {
      const to = Dept.shortName(e.to_loc), from = Dept.shortName(e.from_loc);
      if (e.type === 'ADMIT') return Dept.isSpecial(e.to_loc) ? 'Admitted to ' + to + ' (parent unit ' + from + ')' : 'Admitted to ' + to;
      if (e.type === 'TRANSFER' || e.type === 'TO_IMCU' || e.type === 'FROM_IMCU') return 'Transferred from ' + from + ' to ' + to;
      if (e.type === 'DISCHARGE') return 'Discharged from ' + from;
      if (e.type === 'DEATH') return 'Died in ' + from;
      return e.type;
    },
    where(p) {
      if (Dept.isSpecial(p.location)) return Dept.shortName(p.location) + ' (parent ' + p.home_unit + ')';
      if (p.location === 'KDP') return 'Kandiyaperi ' + (p.sex === 'F' ? 'female' : 'male') + ' ward';
      return p.location + ' ' + (p.sex === 'F' ? 'female' : 'male') + ' ward';
    },

    async admit(p, admitTo, parent, date, time) {
      const home = Dept.isSpecial(admitTo) ? parent : admitTo;
      Object.assign(p, { location: admitTo, home_unit: home, status: 'IN', admit_date: date });
      if (!nz(p.category)) p.category = Dept.categoryIn(p.diagnosis);
      if (admitTo === 'FEVER' && p.dengue == null) {
        const t = Dept.dengueTestIn(p.diagnosis);
        if (t != null) Object.assign(p, { dengue: '1', dengue_test: t, dengue_date: date });
      }
      for (const k of ['ip_no', 'phone', 'address', 'diagnosis', 'bed', 'outcome_date', 'outcome_note', 'cmchis_no']) if (p[k] == null) p[k] = '';
      if (p.cmchis == null) p.cmchis = '0';
      const row = await Store.put('patients', p);
      await Store.put('events', { patient_id: row.id, date, time, type: 'ADMIT', from_loc: home, to_loc: admitTo, note: '' });
      return row.id;
    },
    async editPatient(id, fields, admitTo, parent, date, time) {
      fields.admit_date = date;
      await Store.update('patients', id, fields);
      const adm = Dept.events(id).find(e => e.type === 'ADMIT');
      if (adm) await Store.update('events', adm.id, { date, time, from_loc: Dept.isSpecial(admitTo) ? parent : admitTo, to_loc: admitTo });
      await Dept.recompute(id);
    },
    async addEvent(pid, date, time, type, from, to, note) {
      await Store.put('events', { patient_id: String(pid), date, time, type, from_loc: from || '', to_loc: to || '', note: note || '' });
      await Dept.recompute(pid);
    },
    /** Rebuilds the patient's ward, parent unit and outcome from their events, in order. */
    async recompute(pid) {
      let status = 'IN', loc = null, home = null, outDate = '', outNote = '';
      for (const e of Dept.events(pid)) {
        if (e.type === 'ADMIT') { loc = e.to_loc; home = e.from_loc; }
        else if (e.type === 'TRANSFER') { loc = e.to_loc; if (Dept.isWardUnit(loc) || loc === 'KDP') home = loc; }
        else if (e.type === 'DISCHARGE') { status = 'DISCHARGED'; outDate = e.date; outNote = nz(e.note); }
        else if (e.type === 'DEATH') { status = 'DIED'; outDate = e.date; outNote = nz(e.note); }
      }
      const f = { status, outcome_date: outDate, outcome_note: outNote };
      if (loc != null) f.location = loc;
      if (home) f.home_unit = home;
      await Store.update('patients', pid, f);
    },
    async undoLast(pid) {
      const ev = Dept.events(pid).filter(e => e.type !== 'ADMIT');
      if (!ev.length) return false;
      await Store.remove('events', ev[ev.length - 1].id);
      await Dept.recompute(pid);
      return true;
    },
    defaultDeathPlace(p) {
      if (p.location === 'IMCU') return 'IMCU';
      if (p.location === 'CCB') return 'Critical care block';
      if (p.location === 'TRIAGE') return 'Triage';
      return p.admit_date && p.admit_date >= D.admitDay() ? 'Triage' : 'Ward';
    },
    myStaff() { const id = Auth.staffId(); return id ? Store.get('staff', id) : null; },
    isHod() {
      const s = Dept.myStaff();
      if (Auth.role() === 'hod' || (s && nz(s.role).toUpperCase() === 'HOD')) return true;
      const hod = Store.setting('hod', '');
      const me = (Auth.session() || {}).name || '';
      const norm = x => nz(x).toLowerCase().replace(/^((prof|dr)\.?\s*)+/, '').replace(/[^a-z]/g, '');
      return !!hod && !!me && norm(hod) === norm(me);
    },
    /** Who may change a case sheet: admin, HOD, or linked staff of the patient's ward or admitting unit. */
    canEdit(p) {
      if (Auth.isAdmin() || Dept.isHod()) return true;
      const s = Dept.myStaff();
      if (!s) return false;
      if (nz(s.role).toUpperCase() === 'HOD') return true;
      const u = nz(s.unit);
      if (!u) return false;
      if (p.location === 'IDW' && u === Dept.rotationUnit()) return true;
      return u === nz(p.location) || u === nz(p.home_unit);
    },
    ownerLabel(p) {
      const loc = Dept.shortName(nz(p.location)), home = Dept.shortName(nz(p.home_unit));
      return !home || home === loc ? loc : !loc ? home : home + ' or ' + loc;
    },
    myName() {
      const s = Dept.myStaff();
      return s ? s.name : ((Auth.session() || {}).name || '');
    }
  };

  window.D = D;
  window.Dept = Dept;
  window.nz = nz;
})();
