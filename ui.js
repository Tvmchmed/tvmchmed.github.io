/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary: copying, cloning or AI-assisted recreation without written permission is prohibited. See LICENSE.txt. */
// Small view helpers: element builder, toast, bottom-sheet dialogs and forms (bands for short choice lists, like the Android app).
(function () {
  'use strict';

  /** h('div.card', {onclick}, children...) */
  function h(tag, attrs, ...kids) {
    const m = tag.split('.');
    const el = document.createElement(m[0] || 'div');
    if (m.length > 1) el.className = m.slice(1).join(' ');
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'vars') for (const n in v) el.style.setProperty(n, v[n]);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const c of kids) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) add(el, c);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  /** A bottom sheet. ok(body) returns false (or a promise of false) to keep it open. */
  function sheet(title, body, okLabel, ok, opts) {
    opts = opts || {};
    const root = document.getElementById('sheet');
    root.innerHTML = '';
    const close = () => { root.classList.add('hidden'); root.innerHTML = ''; document.body.style.overflow = ''; };
    let busy = false;
    const okBtn = okLabel ? h('button.btn', { vars: { '--bc': opts.color || 'var(--primary)' }, onclick: async () => {
      if (busy) return;
      busy = true; okBtn.disabled = true;
      try { const r = await ok(); if (r !== false) close(); }
      catch (e) { toast(e.message || String(e)); }
      finally { busy = false; okBtn.disabled = false; }
    } }, okLabel) : null;
    const panel = h('div.panel',
      h('div.ph', h('h2', title), h('button', { onclick: close }, okLabel ? 'Cancel' : 'Close')),
      h('div.pb', body),
      okBtn ? h('div.pf', okBtn) : null);
    root.appendChild(panel);
    root.onclick = e => { if (e.target === root && !opts.modal) close(); };
    root.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    return { close };
  }

  function confirmBox(title, msg, okLabel, fn, color) {
    sheet(title, h('p', msg), okLabel, fn, { color: color || 'var(--red)' });
  }

  /** A form whose fields are read back with get(); show(key, on) hides a row. */
  class Form {
    constructor() { this.el = h('div'); this.fields = {}; this.rows = {}; this.watch = []; }
    row(key, node) { if (key) this.rows[key] = node; this.cur = this.cur || null; (this.halfRow || this.el).appendChild(node); return node; }
    heading(t) { this.el.appendChild(h('div.fh', t)); }
    note(t) { this.el.appendChild(h('p.muted.small', t)); }
    beginRow() { this.halfRow = h('div.halves'); this.el.appendChild(this.halfRow); }
    endRow() { this.halfRow = null; }
    changed() { this.watch.forEach(f => f()); }
    onChange(fn) { this.watch.push(fn); }
    text(key, label, val, type) {
      const i = h('input.in', { type: type === 'number' ? 'text' : (type || 'text'), inputmode: type === 'number' ? 'decimal' : type === 'tel' ? 'tel' : null, value: val == null ? '' : val, oninput: () => this.changed() });
      if (type === 'date' || type === 'time') i.type = type;
      this.fields[key] = { get: () => i.value.trim(), set: v => { i.value = v; }, el: i };
      return this.row(key, h('label.f', h('span', label), i));
    }
    multi(key, label, val) {
      const t = h('textarea.in', { oninput: () => this.changed() });
      t.value = val == null ? '' : val;
      this.fields[key] = { get: () => t.value.trim(), set: v => { t.value = v; }, el: t };
      return this.row(key, h('label.f', h('span', label), t));
    }
    date(key, label, val) { return this.text(key, label, val, 'date'); }
    time(key, label, val) { return this.text(key, label, val, 'time'); }
    /** Bands for short lists (as on Android), a drop-down for long ones. labels may be null. */
    choice(key, label, values, labels, val, color) {
      labels = labels || values;
      const short = values.length <= 14 && labels.every(l => String(l).length <= 30);
      let cur = val == null ? '' : String(val);
      if (!short) {
        const s = h('select.in', { onchange: () => { cur = s.value; this.changed(); } });
        values.forEach((v, i) => { const o = h('option', { value: v }, labels[i] === '' ? '-' : labels[i]); if (String(v) === cur) o.selected = true; s.appendChild(o); });
        if (cur && !values.map(String).includes(cur)) { const o = h('option', { value: cur }, cur); o.selected = true; s.appendChild(o); }
        this.fields[key] = { get: () => s.value, set: v => { s.value = v; }, el: s };
        return this.row(key, h('label.f', h('span', label), s));
      }
      const wrap = h('div.bands');
      const draw = () => {
        wrap.innerHTML = '';
        values.forEach((v, i) => {
          if (v === '' && labels[i] === '') return;
          const on = String(v) === cur;
          wrap.appendChild(h('button.band' + (on ? '.on' : ''), { type: 'button', vars: color ? { '--bc': color } : null,
            onclick: () => { cur = on ? '' : String(v); draw(); this.changed(); } }, labels[i]));
        });
      };
      draw();
      this.fields[key] = { get: () => cur, set: v => { cur = v; draw(); } };
      // a div, not a label: a label would pass every tap on to its first band
      return this.row(key, h('div.f', h('span', label), wrap));
    }
    check(key, label, on) {
      const c = h('input', { type: 'checkbox', onchange: () => this.changed() });
      c.checked = !!on;
      this.fields[key] = { get: () => (c.checked ? '1' : ''), set: v => { c.checked = v === '1' || v === true; }, el: c };
      return this.row(key, h('label.chk', c, h('span', label)));
    }
    get(key) { const f = this.fields[key]; return f ? f.get() : ''; }
    set(key, v) { const f = this.fields[key]; if (f) f.set(v); }
    has(key) { return !!this.fields[key]; }
    show(key, on) { const r = this.rows[key]; if (r) r.classList.toggle('hidden', !on); }
    shown(key) { const r = this.rows[key]; return !r || !r.classList.contains('hidden'); }
  }

  /** A "Choose from list" button under a diagnosis field: picks from the department's diagnosis list. */
  function diagnosisPicker(form, key) {
    const btn = h('button.link', { type: 'button', onclick: () => {
      const q = h('input.in', { placeholder: 'Search diagnoses', oninput: () => draw() });
      const list = h('div');
      const draw = () => {
        list.innerHTML = '';
        const s = q.value.trim().toLowerCase();
        for (const g of window.SCHEMA.diagnoses) {
          const items = g.slice(1).filter(x => !s || x.toLowerCase().includes(s));
          if (!items.length) continue;
          list.appendChild(h('div.fh', g[0]));
          for (const it of items) list.appendChild(h('div.pt', { onclick: () => {
            const cur = form.get(key);
            form.set(key, cur ? cur + ', ' + it : it);
            form.changed();
            box.close();
          } }, h('div.grow', it)));
        }
      };
      draw();
      const box = sheet('Diagnosis', h('div', q, list));
    } }, '+ Choose from the diagnosis list');
    const r = form.rows[key];
    if (r) r.appendChild(btn);
  }

  window.UI = { h, toast, sheet, confirmBox, Form, diagnosisPicker };
})();
