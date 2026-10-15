/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary: copying, cloning or AI-assisted recreation without written permission is prohibited. See LICENSE.txt. */
// The case sheet on the web: the same sections and questions as the Android app (schema.js), saved in the same shared record.
(function () {
  'use strict';
  const { Store } = window.TVM;
  const { h, toast, sheet, confirmBox, Form, diagnosisPicker } = window.UI;
  const SC = window.SCHEMA;
  const K = { MULTI: 0, TEXT: 1, CHECK: 2, CHOICE: 3, DATE: 4, HEAD: 5, NUM: 6, WHEEL: 7 };
  const GROUP_COLORS = { 'Written by': '#4F46E5', History: '#1D4E89', Examination: '#0D9488', Investigations: '#7C3AED', 'Opinions and treatment': '#EA580C',
    'Progress notes': '#0891B2', 'AI check': '#7C3AED', Discharge: '#059669' };
  const LISTS = ['treatment', 'dis_meds', 'progress', 'ai_review'];

  const s = (o, k) => (o[k] == null ? '' : String(o[k]));

  const CS = {
    load(pid) {
      const r = Store.get('case_sheets', pid);
      if (!r) return {};
      try { return JSON.parse(r.data || '{}') || {}; } catch (e) { return {}; }
    },
    async save(pid, data) {
      const now = D.today() + ' ' + D.now();
      await Store.put('case_sheets', { id: String(pid), data: JSON.stringify(data), updated: now });
      // who wrote the case sheet goes on the patient record for the census
      const p = Store.get('patients', pid);
      if (p && (s(data, 'wb_name') !== nz(p.cs_by) || s(data, 'wb_year') !== nz(p.cs_year)))
        await Store.update('patients', pid, { cs_by: s(data, 'wb_name'), cs_year: s(data, 'wb_year') });
    },
    filled(o, sec) {
      if (sec.key === 'treatment' || sec.key === 'dis_meds') return Array.isArray(o[sec.key]) && o[sec.key].length > 0;
      if (sec.key === 'progress') return Array.isArray(o.progress) && o.progress.length > 0;
      if (sec.key === 'ai_review') return !!s(o, 'ai_review');
      if (sec.key === 'complaints' && Array.isArray(o.complaint_list) && o.complaint_list.length) return true;
      return sec.fields.some(f => (f.t === K.CHECK ? s(o, f.k) === '1' : !!s(o, f.k)));
    },
    parts(dx) { return nz(dx).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean); },
    newDiagnoses(o) {
      const out = [];
      for (const n of notesByTime(o)) for (const d of CS.parts(n.new_dx)) if (!out.includes(d)) out.push(d);
      return out;
    },
    withNewDiagnoses(dx, o) {
      let b = nz(dx).trim();
      for (const d of CS.newDiagnoses(o)) {
        if (b.toLowerCase().includes(d.toLowerCase())) continue;
        b += (b ? ', ' : '') + d;
      }
      return b;
    },
    screen
  };

  /** Saving the course drops older summary edits of it, as on Android (DischargeActivity.forgetCourseEdits). */
  function forgetCourseEdits(o) {
    for (const [k, t] of [['summary_edit', 'Course in the hospital'], ['case_summary_edit', 'Course so far']]) {
      const ed = o[k], base = o[k + '_base'];
      if (ed && typeof ed === 'object') delete ed[t];
      if (base && typeof base === 'object') delete base[t];
      if (ed && typeof ed === 'object' && !Object.keys(ed).length) { delete o[k]; delete o[k + '_base']; }
    }
  }

  function notesByTime(o) {
    const a = Array.isArray(o.progress) ? o.progress.map((n, i) => Object.assign({ _i: i }, n)) : [];
    return a.sort((x, y) => (s(x, 'date') + s(x, 'time')).localeCompare(s(y, 'date') + s(y, 'time')) || x._i - y._i);
  }

  /** The complaints as lines, the same way the Android app writes them. */
  function complaintLine(c) {
    const opts = c.opts && typeof c.opts === 'object' ? Object.values(c.opts).map(v => String(v).trim()).filter(Boolean)
      .map(v => (/^(mMRC|NYHA)/.test(v) ? v : v.toLowerCase())) : [];
    let extra = opts.join(', ');
    const note = s(c, 'note').trim();
    if (note) extra = extra ? extra + '; ' + note : note;
    let line = s(c, 'name').trim() + (extra ? ' (' + extra + ')' : '');
    if (s(c, 'dur').trim()) line += ' - ' + s(c, 'dur').trim();
    return line;
  }
  function complaints(o) {
    if (Array.isArray(o.complaint_list)) return o.complaint_list;
    return s(o, 'complaints').split('\n').map(x => x.trim()).filter(Boolean).map(x => {
      const m = x.split(/\s+[-–]\s+|\s*[–:]\s*|\s*-\s*(?=\d)/);
      return m.length > 1 ? { name: m[0], dur: x.slice(m[0].length).replace(/^\s*[-–:]\s*/, '') } : { name: x };
    });
  }
  function putComplaints(o, a) {
    o.complaint_list = a;
    const lines = a.map(complaintLine).filter(Boolean);
    if (lines.length) o.complaints = lines.join('\n'); else delete o.complaints;
  }

  function preview(o, sec) {
    if (sec.key === 'complaints') return complaints(o).map(complaintLine).join(' · ');
    const out = [];
    for (const f of sec.fields) {
      if (f.t === K.HEAD) continue;
      const v = s(o, f.k);
      if (!v) continue;
      if (f.t === K.CHECK) { if (v === '1') out.push(f.l.trim()); }
      else out.push((f.t === K.MULTI && sec.fields.length === 1 ? '' : f.l.replace(/\s*\(.*\)$/, '') + ': ') + v);
    }
    return out.join(' · ');
  }

  // ---------- screen ----------
  function screen(id, L) {
    const p = Store.get('patients', id);
    if (!p) return L.go('#/');
    const data = CS.load(id);
    const editable = Dept.canEdit(p);
    const female = p.sex === 'F';
    const ai = Store.setting('admin_ai_check', 'on') !== 'off';
    const content = [
      h('div.card.hero', h('div', { style: { fontWeight: 700, fontSize: '17px' } }, p.name + (p.age ? ', ' + p.age + ' y' : '') + ', ' + (female ? 'female' : 'male')),
        h('div.muted', (p.diagnosis ? p.diagnosis + ' · ' : '') + 'Admitted ' + D.nice(p.admit_date)),
        h('div.muted.small', { style: { marginTop: '6px' } }, 'Shared online with the Android app and the department. Tap a section to ' + (editable ? 'fill it.' : 'read it.'))),
      editable ? null : h('div.card', { style: { background: '#FEF3C7', color: '#92400E' } }, h('b', '🔒 View only'),
        h('div.small', 'This case sheet belongs to ' + Dept.ownerLabel(p) + '. Only its faculty, PGs and CRMIs, the admin and the HOD can change it.'))
    ];
    let group = null;
    for (const sec of SC.sections) {
      if (sec.female && !female) continue;
      if (sec.key === 'ai_review' && !ai) continue;
      if (sec.group !== group) { group = sec.group; content.push(L.heading(group, GROUP_COLORS[group])); }
      content.push(sectionCard(sec, data, p, editable, GROUP_COLORS[group]));
    }
    L.page('Case sheet', p.name, content, { back: true, color: '#1D4E89', tab: false, keepScroll: window.__csScroll || 0 });
    window.__csScroll = 0;
  }

  function redraw() { window.__csScroll = window.scrollY; window.dispatchEvent(new HashChangeEvent('hashchange')); }

  function sectionCard(sec, data, p, editable, color) {
    const filled = CS.filled(data, sec);
    const top = h('div.row', h('div.grow.title', sec.title), h('span.pill', { vars: { '--pc': filled ? 'var(--green)' : '#94A3B8' } }, filled ? '✓ Filled' : editable ? 'Add' : 'Empty'));
    const card = h('div.card.sec', { vars: { '--hc': color } }, top);
    if (sec.key === 'progress') progressList(card, data, p, editable);
    else if (sec.key === 'treatment' || sec.key === 'dis_meds') drugList(card, data, p, editable, sec.key);
    else if (sec.key === 'ai_review') {
      card.appendChild(h('p.muted.small', s(data, 'ai_review') ? s(data, 'ai_review').slice(0, 600) : 'The AI check is done from the Android app (decision support only: the treating doctor decides).'));
    } else if (sec.key === 'complaints') complaintCard(card, data, p, editable);
    else {
      const pv = preview(data, sec);
      if (pv) card.appendChild(h('div.muted', { style: { marginTop: '6px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, pv));
      card.classList.add('tap');
      card.onclick = () => edit(sec, data, p, editable);
    }
    return card;
  }

  function visible(f, fields, fd) {
    if (!fd.if) return true;
    if (!fd.is.split('|').includes(f.get(fd.if))) return false;
    const c = fields.find(x => x.k === fd.if);
    return c ? visible(f, fields, c) : true;
  }

  function edit(sec, data, p, editable) {
    const f = new Form();
    const fields = sec.fields.filter(fd => !fd.sex || fd.sex === p.sex);
    let half = 0;
    for (const fd of fields) {
      const v = s(data, fd.k);
      if (fd.h && !half) { f.beginRow(); }
      switch (fd.t) {
        case K.HEAD: f.heading(fd.l); break;
        case K.MULTI: f.multi(fd.k, fd.l, v); break;
        case K.TEXT: f.text(fd.k, fd.l, v); break;
        case K.NUM: f.text(fd.k, fd.l, v, 'number'); break;
        case K.CHECK: f.check(fd.k, fd.l.trim(), v === '1'); break;
        case K.DATE: f.date(fd.k, fd.l, v); break;
        case K.CHOICE: f.choice(fd.k, fd.l, fd.o, fd.o.map(x => x === '' ? '' : x), v); break;
        case K.WHEEL: {
          const opts = [''];
          for (let i = fd.min; i <= fd.max; i++) opts.push(String(i));
          f.choice(fd.k, fd.l, opts, opts.map(x => x ? x + (fd.o && fd.o[0] ? ' ' + fd.o[0] : '') : '-'), v);
          break;
        }
      }
      if (fd.h) { half++; if (half === 2) { f.endRow(); half = 0; } }
      else if (half) { f.endRow(); half = 0; }
      if ((fd.k === 'final_dx' || fd.k === 'diagnosis') && editable) diagnosisPicker(f, fd.k);
    }
    if (half) f.endRow();
    if (sec.key === 'final' && !s(data, 'final_dx')) f.set('final_dx', CS.withNewDiagnoses(nz(p.diagnosis), data));
    const vis = () => { for (const fd of fields) if (fd.k && fd.if) f.show(fd.k, visible(f, fields, fd)); };
    f.onChange(vis);
    vis();
    if (!editable) {
      f.el.querySelectorAll('input,textarea,select,button').forEach(x => { x.disabled = true; });
      return sheet(sec.title + ' (view only)', f.el);
    }
    sheet(sec.title, f.el, 'Save', async () => {
      const cur = CS.load(p.id);       // the latest copy, in case it changed on another device meanwhile
      for (const fd of sec.fields) {
        if (fd.t === K.HEAD || !fd.k) continue;
        const shown = fields.includes(fd) && visible(f, fields, fd);
        const v = shown ? f.get(fd.k) : '';
        if (fd.t === K.CHECK && v !== '1') delete cur[fd.k];
        else if (!v) delete cur[fd.k];
        else cur[fd.k] = v;
      }
      if (sec.key === 'course') forgetCourseEdits(cur);
      await CS.save(p.id, cur);
      redraw();
    });
  }

  // complaints: a list of complaint + duration (+ description)
  function complaintCard(card, data, p, editable) {
    const list = complaints(data);
    list.forEach((c, i) => card.appendChild(h('div.pt', { onclick: () => complaint(i, data, p, editable) }, h('div.grow', h('div.nm', s(c, 'name')), h('div.muted.small', complaintLine(c).slice(s(c, 'name').length).replace(/^ - /, ''))))));
    if (editable) card.appendChild(h('button.btn.out', { style: { marginTop: '8px' }, onclick: () => complaint(-1, data, p, editable) }, '+ Add complaint'));
  }

  function complaint(idx, data, p, editable) {
    const cur = CS.load(p.id);
    const list = complaints(cur).slice();
    const c = idx >= 0 ? Object.assign({}, list[idx]) : {};
    const f = new Form();
    const names = [];
    for (const g of SC.complaints) for (let i = 1; i < g.length; i++) names.push(g[i][0]);
    const dl = h('datalist', { id: 'cnames' }, names.map(n => h('option', { value: n })));
    f.text('name', 'Complaint', s(c, 'name'));
    f.fields.name.el.setAttribute('list', 'cnames');
    f.el.appendChild(dl);
    f.text('dur', 'Duration (e.g. 5 days, 2 weeks)', s(c, 'dur'));
    const descBox = h('div');
    f.el.appendChild(descBox);
    const desc = s(c, 'note') ? s(c, 'note').split(/,\s*/) : [];
    const drawDesc = () => {
      descBox.innerHTML = '';
      const opts = SC.hpiDesc[f.get('name')] || [];
      if (!opts.length) return;
      descBox.appendChild(h('div.fh', 'Description'));
      descBox.appendChild(h('div.bands', opts.map(o => h('button.band' + (desc.includes(o) ? '.on' : ''), { type: 'button', onclick: () => {
        const i = desc.indexOf(o); if (i >= 0) desc.splice(i, 1); else desc.push(o); drawDesc();
      } }, o))));
    };
    f.onChange(drawDesc);
    drawDesc();
    f.text('other', 'Other details', '');
    if (idx >= 0) f.check('delete', 'Remove this complaint (tap Save)', false);
    if (!editable) return sheet('Complaint', f.el);
    sheet(idx >= 0 ? 'Edit complaint' : 'Add complaint', f.el, 'Save', async () => {
      if (f.get('delete') === '1') list.splice(idx, 1);
      else {
        if (!f.get('name')) { toast('Enter the complaint'); return false; }
        const notes = desc.slice();
        if (f.get('other')) notes.push(f.get('other'));
        const n = Object.assign({}, c, { name: f.get('name'), dur: f.get('dur') });
        if (notes.length) n.note = notes.join(', '); else delete n.note;
        if (idx >= 0) list[idx] = n; else list.push(n);
      }
      putComplaints(cur, list);
      await CS.save(p.id, cur);
      redraw();
    });
  }

  // progress notes
  const STATUS_COLOR = { Better: 'var(--green)', Same: '#64748B', Worse: '#EA580C', Critical: 'var(--red)' };
  const VITALS = [['pr', 'Pulse (/min)'], ['sbp', 'SBP (mmHg)'], ['dbp', 'DBP (mmHg)'], ['rr', 'RR (/min)'], ['spo2', 'SpO2 (%)'], ['temp', 'Temp (°F)'], ['grbs', 'GRBS (mg/dl)']];
  function progressList(card, data, p, editable) {
    const notes = notesByTime(data).reverse();
    notes.forEach(n => {
      const v = VITALS.map(([k, l]) => (n[k] ? l.split(' ')[0] + ' ' + n[k] : '')).filter(Boolean).join(', ');
      card.appendChild(h('div.pt', { onclick: () => note(n._i, p, editable) },
        h('div.grow', h('div.row', h('span.nm', D.nice(n.date) + (n.time ? ' ' + n.time : '')), n.status ? h('span.pill', { vars: { '--pc': STATUS_COLOR[n.status] || '#64748B' } }, n.status) : null),
          h('div.small', [n.hx, v, n.exam, n.results, n.new_dx ? 'New diagnosis: ' + n.new_dx : '', n.plan ? 'Plan: ' + n.plan : ''].filter(Boolean).join(' · ')),
          n.by ? h('div.muted.small', 'By ' + n.by) : null)));
    });
    if (!notes.length) card.appendChild(h('p.muted.small', 'No progress notes yet.'));
    if (editable) card.appendChild(h('button.btn.out', { style: { marginTop: '8px' }, vars: { '--bc': '#0891B2' }, onclick: () => note(-1, p, editable) }, '+ Add progress note'));
  }

  function note(idx, p, editable) {
    const cur = CS.load(p.id);
    const all = Array.isArray(cur.progress) ? cur.progress.slice() : [];
    const n = idx >= 0 ? all[idx] : null;
    const g = k => (n ? s(n, k) : '');
    const f = new Form();
    f.beginRow(); f.date('date', 'Date', n ? g('date') : D.today()); f.time('time', 'Time', n ? g('time') : D.now()); f.endRow();
    f.choice('status', 'Patient today', SC.progressStatus, null, g('status'));
    f.multi('hx', 'Changes in history / new symptoms', g('hx'));
    f.heading('Vitals');
    for (let i = 0; i < VITALS.length; i += 2) {
      f.beginRow();
      f.text(VITALS[i][0], VITALS[i][1], g(VITALS[i][0]), 'number');
      if (VITALS[i + 1]) f.text(VITALS[i + 1][0], VITALS[i + 1][1], g(VITALS[i + 1][0]), 'number');
      f.endRow();
    }
    f.multi('exam', 'Clinical findings (new or changed signs)', g('exam'));
    f.multi('results', 'New investigation results', g('results'));
    f.multi('new_dx', 'New diagnosis added today', g('new_dx'));
    diagnosisPicker(f, 'new_dx');
    f.multi('plan', 'Plan / changes in treatment', g('plan'));
    if (editable) f.check('to_dx', 'Add the new diagnosis to the patient’s diagnosis', true);
    if (editable && n) f.check('delete', 'Delete this note (tap Save)', false);
    if (!editable) return sheet('Progress note', f.el);
    sheet(n ? 'Edit progress note' : 'Progress note', f.el, 'Save', async () => {
      if (f.get('delete') === '1') {
        all.splice(idx, 1);
      } else {
        const o = {};
        let any = false;
        for (const k of ['date', 'time', 'status', 'hx', 'pr', 'sbp', 'dbp', 'rr', 'spo2', 'temp', 'grbs', 'exam', 'results', 'new_dx', 'plan']) {
          const v = f.get(k);
          if (!v) continue;
          o[k] = v;
          if (k !== 'date' && k !== 'time') any = true;
        }
        if (!any) { toast('Write what changed, the findings or the plan'); return false; }
        o.by = n && s(n, 'by') ? s(n, 'by') : Dept.myName();
        if (n) all[idx] = o; else all.push(o);
        if (f.get('to_dx') === '1' && f.get('new_dx')) {
          const dx = nz(p.diagnosis);
          const merged = CS.parts(dx).length ? CS.withNewDiagnoses(dx, { progress: [{ new_dx: f.get('new_dx') }] }) : f.get('new_dx');
          if (merged !== dx) await Store.update('patients', p.id, { diagnosis: merged });
        }
      }
      cur.progress = all;
      await CS.save(p.id, cur);
      redraw();
    });
  }

  // treatment chart and discharge medicines
  function drugList(card, data, p, editable, key) {
    const a = Array.isArray(data[key]) ? data[key] : [];
    a.forEach((d, i) => {
      const sub = [d.type, d.dose, d.route, d.freq, d.days ? d.days + (/^\d+$/.test(d.days) ? ' days' : '') : '', d.food].filter(Boolean).join(' · ');
      card.appendChild(h('div.pt', { onclick: () => drug(i, key, p, editable) }, h('div.grow', h('div.nm', d.name || ''), h('div.muted.small', sub)),
        d.continue === '1' ? h('span.pill', { vars: { '--pc': 'var(--teal)' } }, 'On discharge') : null));
    });
    if (!a.length) card.appendChild(h('p.muted.small', key === 'dis_meds' ? 'Medicines to take at home: drug, dose, frequency and days.' : 'No drugs on the chart yet.'));
    if (editable) card.appendChild(h('button.btn.out', { style: { marginTop: '8px' }, vars: { '--bc': '#EA580C' }, onclick: () => drug(-1, key, p, editable) }, key === 'dis_meds' ? '+ Add discharge medicine' : '+ Add treatment'));
  }

  function drug(idx, key, p, editable) {
    const dis = key === 'dis_meds';
    const cur = CS.load(p.id);
    const a = Array.isArray(cur[key]) ? cur[key].slice() : [];
    const d = idx >= 0 ? a[idx] : {};
    const f = new Form();
    f.choice('type', 'Type', SC.drugTypes, null, d.type || 'Tablet', '#EA580C');
    f.text('name', 'Drug or fluid name', d.name || '');
    f.text('dose', 'Dose (e.g. 500 mg, 1 g, 500 ml, 8 units)', d.dose || '');
    f.choice('route', 'Route', SC.routes, null, d.route || '');
    f.text('freq', 'Frequency or rate (OD, BD, TDS, 75 ml/hr…)', d.freq || '');
    const fl = h('datalist', { id: 'freqs' }, SC.freqs.map(x => h('option', { value: x })));
    f.fields.freq.el.setAttribute('list', 'freqs');
    f.el.appendChild(fl);
    f.text('days', 'Days', d.days || '');
    if (dis) f.choice('food', 'Food', SC.food, null, d.food || '');
    else f.check('continue', 'Continue on discharge (goes into the discharge advice)', d.continue === '1');
    if (idx >= 0) f.check('delete', 'Remove this drug (tap Save)', false);
    if (!editable) return sheet('Drug', f.el);
    sheet(idx >= 0 ? 'Edit' : dis ? 'Add discharge medicine' : 'Add treatment', f.el, 'Save', async () => {
      if (f.get('delete') === '1') a.splice(idx, 1);
      else {
        if (!f.get('name')) { toast('Enter the drug or fluid'); return false; }
        const n = { type: f.get('type'), name: f.get('name'), dose: f.get('dose'), freq: f.get('freq'), days: f.get('days') };
        if (f.get('route')) n.route = f.get('route');
        if (!dis && f.get('continue') === '1') n.continue = '1';
        if (dis && f.get('food')) n.food = f.get('food');
        if (idx >= 0) a[idx] = n; else a.push(n);
      }
      cur[key] = a;
      await CS.save(p.id, cur);
      redraw();
    });
  }

  window.CaseSheetWeb = CS;
})();
