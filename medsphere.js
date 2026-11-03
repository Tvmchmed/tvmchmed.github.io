/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary. See LICENSE.txt. */
/*
 * MedSphere (10.60, questions and polls 10.61): the department's private meeting room on LiveKit with end-to-end encryption.
 * The app opens this page with a members-only pass in the address fragment (never sent to any server):
 *   #u=<LiveKit url>&t=<pass>&k=<encryption key>&r=<room>&n=<my name>&ti=<title>&h=<1 host>&f=<function url>&a=<login>&p=<apikey>
 * The page refuses to join where end-to-end encryption is not supported. Nothing is recorded; the room has no record button,
 * the Android app blocks screenshots and screen recording, and every viewer's name is watermarked across the screen.
 */
'use strict';
(function () {
  const LK = window.LivekitClient;
  const $ = (id) => document.getElementById(id);
  const P = {};
  for (const kv of location.hash.replace(/^#/, '').split('&')) {
    const i = kv.indexOf('=');
    if (i > 0) P[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  }
  // the pass must not stay in the address bar or the history
  try { history.replaceState(null, '', location.pathname); } catch (e) { }
  const host = P.h === '1';
  let room = null, joinedAt = 0, handUp = false, ended = false;

  function toast(s) {
    const t = $('toast');
    t.textContent = s;
    t.style.display = 'block';
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.style.display = 'none'; }, 3200);
  }

  function message(text, button, onClick) {
    $('msg').style.display = 'flex';
    $('msgText').textContent = text;
    const old = $('msg').querySelector('button');
    if (old) old.remove();
    if (button) {
      const b = document.createElement('button');
      b.textContent = button;
      b.onclick = onClick;
      $('msg').appendChild(b);
    }
  }

  function watermark() {
    const m = $('mark');
    const when = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const s = (P.n || 'Member') + ' · ' + when + ' · TVMCHMED';
    m.innerHTML = '';
    for (let i = 0; i < 160; i++) {
      const sp = document.createElement('span');
      sp.textContent = s;
      m.appendChild(sp);
    }
  }

  function initials(n) {
    const w = String(n || '?').replace(/^(dr|prof)\.?\s+/i, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }

  // ---------- the tiles ----------

  function tileOf(p) {
    let t = document.getElementById('p-' + p.identity);
    if (!t) {
      t = document.createElement('div');
      t.className = 'tile';
      t.id = 'p-' + p.identity;
      t.innerHTML = '<div class="av"><div></div></div><div class="nm"></div>';
      $('grid').appendChild(t);
    }
    return t;
  }

  function draw() {
    if (!room) return;
    const all = [room.localParticipant, ...[...room.remoteParticipants.values()].filter((p) => !waitingP(p))];
    const keep = new Set(all.map((p) => 'p-' + p.identity));
    const waiting = [...room.remoteParticipants.values()].filter(waitingP).length;
    if (host && waiting > draw.waiting) toast('🚪 Someone is in the waiting room: tap 👥 to let them in');
    draw.waiting = waiting;
    for (const el of [...$('grid').children]) if (!keep.has(el.id)) el.remove();
    let screen = null;
    for (const p of all) {
      const t = tileOf(p);
      const name = (p.name || p.identity) + (p === room.localParticipant ? ' (you)' : '');
      const cam = p.getTrackPublication(LK.Track.Source.Camera);
      const mic = p.getTrackPublication(LK.Track.Source.Microphone);
      const sc = p.getTrackPublication(LK.Track.Source.ScreenShare);
      if (sc && sc.track && !sc.isMuted) screen = { p, track: sc.track };
      t.querySelector('.nm').textContent = (mic && !mic.isMuted ? '🎤 ' : '🔇 ') + name;
      t.querySelector('.av div').textContent = initials(p.name || p.identity);
      let v = t.querySelector('video');
      if (cam && cam.track && !cam.isMuted) {
        if (!v) {
          v = cam.track.attach();
          v.muted = true;
          t.insertBefore(v, t.firstChild);
        } else if (v.srcObject !== cam.track.mediaStream) {
          cam.track.attach(v);
        }
        t.querySelector('.av').style.display = 'none';
      } else {
        if (v) v.remove();
        t.querySelector('.av').style.display = 'flex';
      }
      if (p === room.localParticipant && v) v.style.transform = 'scaleX(-1)';
      const hand = (p.attributes || {}).hand === '1';
      let h = t.querySelector('.hand');
      if (hand && !h) {
        h = document.createElement('div');
        h.className = 'hand';
        h.textContent = '✋';
        t.appendChild(h);
      } else if (!hand && h) h.remove();
      t.classList.toggle('speaking', !!p.isSpeaking);
    }
    const box = $('screen');
    if (screen) {
      box.style.display = 'block';
      let v = box.querySelector('video');
      if (!v) {
        v = document.createElement('video');
        v.autoplay = true;
        v.playsInline = true;
        v.muted = true;
        box.appendChild(v);
      }
      screen.track.attach(v);
      box.title = 'Shared by ' + (screen.p.name || screen.p.identity);
    } else {
      box.style.display = 'none';
      box.innerHTML = '';
    }
    $('count').textContent = all.length + (all.length === 1 ? ' person' : ' people') + ' in ' + (P.ti || 'the room');
    const lp = room.localParticipant;
    $('mic').className = lp.isMicrophoneEnabled ? '' : 'off';
    $('cam').className = lp.isCameraEnabled ? '' : 'off';
    $('share').className = lp.isScreenShareEnabled ? 'on' : '';
    $('hand').className = handUp ? 'on' : '';
    if ($('people').style.display === 'block') people();
  }

  // remote voices play through hidden audio elements
  function attachAudio(track) {
    if (track.kind !== 'audio') return;
    const a = track.attach();
    a.style.display = 'none';
    document.body.appendChild(a);
  }

  // ---------- the participants list (hosts: mute everyone, remove someone) ----------

  async function hostAction(action, identity) {
    try {
      const r = await fetch(P.f, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + P.a, apikey: P.p, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, room: P.r, identity }),
      });
      const j = await r.json();
      toast(j.error ? j.error : action === 'muteall' ? 'Everyone else is muted' : action === 'admit' ? 'Let in' : 'Removed from the meeting');
    } catch (e) {
      toast('Could not reach the server');
    }
  }

  function people() {
    const box = $('people');
    box.innerHTML = '<h3>In this meeting</h3>';
    if (host) {
      const b = document.createElement('button');
      b.textContent = '🔇 Mute everyone else';
      b.onclick = () => hostAction('muteall');
      box.appendChild(b);
      const tb = document.createElement('div');
      tb.className = 'tbtns';
      tb.innerHTML = '<span style="width:100%;font-size:12px;color:var(--muted)">⏱ Speaker timer</span>';
      for (const m of [5, 10, 15, 20]) {
        const x = document.createElement('button');
        x.textContent = m + ' min';
        x.onclick = () => startTimer(m);
        tb.appendChild(x);
      }
      if (timerEnd) {
        const x = document.createElement('button');
        x.className = 'red';
        x.textContent = 'Stop';
        x.onclick = () => startTimer(0);
        tb.appendChild(x);
      }
      box.appendChild(tb);
      const wl = [...room.remoteParticipants.values()].filter(waitingP);
      if (wl.length) {
        const w = document.createElement('div');
        w.className = 'wait';
        w.textContent = '🚪 Waiting room (' + wl.length + ')';
        box.appendChild(w);
        for (const p of wl) {
          const row = document.createElement('div');
          row.className = 'row';
          const s = document.createElement('span');
          s.textContent = p.name || p.identity;
          row.appendChild(s);
          const a = document.createElement('button');
          a.textContent = 'Let in';
          a.onclick = () => { a.disabled = true; hostAction('admit', p.identity); };
          row.appendChild(a);
          box.appendChild(row);
        }
      }
    }
    const all = [room.localParticipant, ...[...room.remoteParticipants.values()].filter((p) => !waitingP(p))];
    all.sort((x, y) => ((y.attributes || {}).hand === '1') - ((x.attributes || {}).hand === '1'));
    for (const p of all) {
      const row = document.createElement('div');
      row.className = 'row';
      const s = document.createElement('span');
      s.textContent = ((p.attributes || {}).hand === '1' ? '✋ ' : '') + (p.name || p.identity) + (p === room.localParticipant ? ' (you)' : '');
      row.appendChild(s);
      if (host && p !== room.localParticipant) {
        const r = document.createElement('button');
        r.className = 'red';
        r.textContent = 'Remove';
        r.onclick = () => { if (confirm('Remove ' + (p.name || 'this person') + ' from the meeting?')) hostAction('remove', p.identity); };
        row.appendChild(r);
      }
      box.appendChild(row);
    }
  }

  function float(emoji) {
    const f = document.createElement('div');
    f.className = 'float';
    f.textContent = emoji;
    f.style.left = (10 + Math.random() * 75) + '%';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 2700);
  }

  // ---------- questions and polls (10.61) ----------
  // Sent to everyone in the room over the meeting's data channel; nothing is stored anywhere. A host shares the current
  // questions and polls with anyone who joins late.
  const QS = new Map(), POLLS = new Map();
  let qaTab = 'q';
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const me = () => (room ? room.localParticipant.identity : 'me');
  const isHost = (p) => { if (!p) return false; if (room && p === room.localParticipant) return host; try { return !!JSON.parse(p.metadata || '{}').host; } catch (e) { return false; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function send(obj, to) {
    if (!room) return;
    try { await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), to ? { reliable: true, destinationIdentities: to } : { reliable: true }); } catch (e) { }
  }

  function addQ(q) {
    if (!q || !q.id || QS.has(q.id)) return false;
    QS.set(q.id, { id: q.id, text: String(q.text || '').slice(0, 300), by: String(q.by || ''), at: q.at || Date.now(), ups: new Set(q.ups || []), done: !!q.done });
    return true;
  }
  function addPoll(x) {
    if (!x || !x.id || POLLS.has(x.id)) return false;
    POLLS.set(x.id, { id: x.id, q: String(x.q || ''), opts: (x.opts || []).slice(0, 4).map(String), right: x.right === '' || x.right == null ? null : Number(x.right),
      votes: new Map(x.votes || []), closed: !!x.closed, at: x.at || Date.now() });
    return true;
  }

  function onData(d, p) {
    const who = p ? p.identity : '';
    if (d.ask && addQ(d.ask)) { if (!qaOpen() || qaTab !== 'q') dot(true); toast('❓ New question'); }
    if (d.up && QS.has(d.up.id) && who) { const q = QS.get(d.up.id); if (d.up.on === false) q.ups.delete(who); else q.ups.add(who); }
    if (d.done && isHost(p) && QS.has(d.done)) QS.get(d.done).done = true;
    if (d.poll && isHost(p) && addPoll(d.poll)) { toast('📊 New poll: tap to answer'); openQa('p'); }
    if (d.vote && POLLS.has(d.vote.id) && who && !POLLS.get(d.vote.id).closed) POLLS.get(d.vote.id).votes.set(who, Number(d.vote.i));
    if (d.pclose && isHost(p) && POLLS.has(d.pclose)) { POLLS.get(d.pclose).closed = true; toast('📊 Poll closed: see the results'); }
    if (d.timer && isHost(p)) setTimer(Number(d.timer.left) || 0);
    if (d.case && d.case.id && !waitingP(p || {})) { showCase(d.case); toast('🩺 ' + (d.case.byName || 'A member') + ' is showing a case'); }
    if (d.caseoff && shownCase && shownCase.id === d.caseoff) showCase(null);
    if (d.sync && isHost(p)) {
      if (d.sync.timer) setTimer(Number(d.sync.timer) || 0);
      if (d.sync.case) showCase(d.sync.case);
      for (const q of d.sync.q || []) { addQ(q); const o = QS.get(q.id); if (o) { for (const u of q.ups || []) o.ups.add(u); if (q.done) o.done = true; } }
      for (const x of d.sync.polls || []) { addPoll(x); const o = POLLS.get(x.id); if (o) { for (const [k, v] of x.votes || []) o.votes.set(k, v); if (x.closed) o.closed = true; } }
    }
    drawQa();
  }

  function syncTo(identity) {
    if (!host || (!QS.size && !POLLS.size && !timerEnd && !shownCase)) return;
    send({ sync: {
      timer: timerLeft(), case: shownCase,
      q: [...QS.values()].map((q) => ({ id: q.id, text: q.text, by: q.by, at: q.at, ups: [...q.ups], done: q.done })),
      polls: [...POLLS.values()].map((x) => ({ id: x.id, q: x.q, opts: x.opts, right: x.right, votes: [...x.votes], closed: x.closed, at: x.at })),
    } }, [identity]);
  }

  const qaOpen = () => $('qaBox').style.display === 'block';
  function dot(on) { $('qaDot').style.display = on ? 'block' : 'none'; }
  function openQa(tab) {
    $('qaBox').style.display = 'block';
    $('people').style.display = 'none';
    if (tab) qaTab = tab;
    dot(false);
    drawQa();
  }

  function drawQa() {
    const open = [...QS.values()].filter((q) => !q.done).length, live = [...POLLS.values()].filter((x) => !x.closed).length;
    $('qCount').textContent = open ? '(' + open + ')' : '';
    $('pCount').textContent = live ? '(' + live + ')' : '';
    $('tabQ').className = qaTab === 'q' ? 'sel' : '';
    $('tabP').className = qaTab === 'p' ? 'sel' : '';
    $('tabC').className = qaTab === 'c' ? 'sel' : '';
    $('qPane').hidden = qaTab !== 'q';
    $('pPane').hidden = qaTab !== 'p';
    $('cPane').hidden = qaTab !== 'c';
    if (qaTab === 'c' && qaOpen()) drawCases();
    $('pMake').hidden = !host;
    if (!qaOpen()) return;
    // questions: most upvoted first, answered ones at the end
    const qs = [...QS.values()].sort((a, b) => (a.done - b.done) || (b.ups.size - a.ups.size) || (a.at - b.at));
    $('qList').innerHTML = qs.length ? '' : '<p style="color:var(--muted);font-size:13px">No questions yet. Ask the first one.</p>';
    for (const q of qs) {
      const row = document.createElement('div');
      row.className = 'q' + (q.done ? ' done' : '');
      const mine = q.ups.has(me());
      row.innerHTML = '<button class="up' + (mine ? ' mine' : '') + '">▲<b>' + q.ups.size + '</b></button><div class="t">' + esc(q.text)
        + '<small>' + (q.by ? esc(q.by) : 'Name hidden') + (q.done ? ' · answered' : '') + '</small></div>';
      row.querySelector('.up').onclick = () => {
        const on = !q.ups.has(me());
        if (on) q.ups.add(me()); else q.ups.delete(me());
        send({ up: { id: q.id, on } });
        drawQa();
      };
      if (host && !q.done) {
        const b = document.createElement('button');
        b.textContent = '✓ Mark answered';
        b.onclick = () => { q.done = true; send({ done: q.id }); drawQa(); };
        row.querySelector('.t').appendChild(b);
      }
      $('qList').appendChild(row);
    }
    // polls: newest first
    const ps = [...POLLS.values()].sort((a, b) => b.at - a.at);
    $('pList').innerHTML = ps.length ? '' : '<p style="color:var(--muted);font-size:13px">' + (host ? 'Start a poll or an MCQ above.' : 'No poll yet. The host starts them.') + '</p>';
    for (const x of ps) {
      const box = document.createElement('div');
      box.className = 'poll';
      const myVote = x.votes.has(me()) ? x.votes.get(me()) : null;
      const show = host || x.closed || myVote != null;
      const counts = x.opts.map((_, i) => [...x.votes.values()].filter((v) => v === i).length);
      const total = x.votes.size;
      box.innerHTML = '<b>' + (x.right != null ? '🧠 MCQ: ' : '📊 ') + esc(x.q) + '</b>';
      x.opts.forEach((o, i) => {
        const b = document.createElement('button');
        const pct = total ? Math.round(counts[i] * 100 / total) : 0;
        b.className = 'opt' + (myVote === i ? ' mine' : '') + (x.closed && x.right === i ? ' right' : '');
        b.innerHTML = (show ? '<div class="bar" style="width:' + pct + '%"></div>' : '') + '<span>' + 'ABCD'[i] + '. ' + esc(o)
          + (show ? '  ·  ' + pct + '% (' + counts[i] + ')' : '') + (x.closed && x.right === i ? '  ✓' : '') + '</span>';
        b.disabled = x.closed;
        b.onclick = () => { x.votes.set(me(), i); send({ vote: { id: x.id, i } }); drawQa(); };
        box.appendChild(b);
      });
      const s = document.createElement('small');
      s.textContent = total + (total === 1 ? ' answer' : ' answers') + (x.closed ? ' · closed' : myVote != null ? ' · you can change your answer until the host closes it' : '');
      box.appendChild(s);
      if (host && !x.closed) {
        const h = document.createElement('div');
        h.className = 'host';
        const c = document.createElement('button');
        c.textContent = x.right != null ? 'Close and show the answer' : 'Close the poll';
        c.onclick = () => { x.closed = true; send({ pclose: x.id }); drawQa(); };
        h.appendChild(c);
        box.appendChild(h);
      }
      $('pList').appendChild(box);
    }
  }

  // ---------- speaker timer (10.61): the host starts it, everyone sees it count down ----------
  let timerEnd = 0, timerTick = null;
  function setTimer(left) {
    timerEnd = left > 0 ? Date.now() + left * 1000 : 0;
    clearInterval(timerTick);
    const el = $('timer');
    if (!timerEnd) { el.hidden = true; return; }
    el.hidden = false;
    const tick = () => {
      const s = Math.round((timerEnd - Date.now()) / 1000);
      if (s <= 0) { el.textContent = '⏱ Time up'; el.className = 'low up'; return; }
      el.textContent = '⏱ ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      el.className = s <= 60 ? 'low' : '';
    };
    tick();
    timerTick = setInterval(tick, 1000);
  }
  function startTimer(min) {
    setTimer(min * 60);
    send({ timer: { left: min * 60 } });
    toast(min ? 'Speaker timer: ' + min + ' min' : 'Timer stopped');
  }
  const timerLeft = () => (timerEnd ? Math.max(0, Math.round((timerEnd - Date.now()) / 1000)) : 0);

  // ---------- present a ward case (10.61): no name, no IP number ----------
  let shownCase = null;
  function myCases() {
    try { if (window.MedSphereApp && window.MedSphereApp.cases) return JSON.parse(window.MedSphereApp.cases()); } catch (e) { }
    try { if (window.opener && window.opener.MedSphereCases) return JSON.parse(window.opener.MedSphereCases()); } catch (e) { }
    return null;
  }
  function drawCases() {
    const list = myCases(), box = $('cList');
    box.innerHTML = '';
    if (!list) { box.innerHTML = '<p class="hint">Open MedSphere from the TVMCHMED app or website to present a case.</p>'; return; }
    if (!list.length) { box.innerHTML = '<p class="hint">No in-patients in your unit right now.</p>'; return; }
    if (shownCase && shownCase.by === me()) {
      const stop = document.createElement('button');
      stop.className = 'gold';
      stop.textContent = 'Stop showing the case';
      stop.onclick = () => { send({ caseoff: shownCase.id }); showCase(null); drawCases(); };
      box.appendChild(stop);
    }
    for (const c of list) {
      const b = document.createElement('button');
      b.className = 'cs';
      b.innerHTML = '<b>' + esc(c.label) + '</b>' + esc(c.dx || 'Diagnosis not entered') + (c.day ? ' · day ' + c.day : '');
      b.onclick = () => {
        const x = Object.assign({}, c, { id: rid(), by: me(), byName: P.n || '', ask: $('cAsk').value.trim() });
        showCase(x);
        send({ case: x });
        $('cAsk').value = '';
        $('qaBox').style.display = 'none';
        toast('Everyone can see the case now');
      };
      box.appendChild(b);
    }
  }
  function showCase(c) {
    shownCase = c;
    const el = $('case');
    if (!c) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<button class="x" title="Hide">✕</button><h4>🩺 Case: ' + esc(c.label) + (c.day ? ' · day ' + esc(c.day) : '') + '</h4>'
      + '<div class="dx">' + esc(c.dx || 'Diagnosis not entered') + '</div>'
      + (c.vitals ? '<div class="ln"><b>Vitals</b>  ' + esc(c.vitals) + '</div>' : '')
      + (c.labs ? '<div class="ln"><b>Labs</b>  ' + esc(c.labs) + '</div>' : '')
      + (c.ask ? '<div class="askq">❓ ' + esc(c.ask) + '</div>' : '')
      + '<small>Shown by ' + esc(c.byName || 'a member') + ' · name and IP number hidden</small>';
    el.querySelector('.x').onclick = () => { el.hidden = true; };
  }

  // ---------- waiting room (10.61) ----------
  const waitingP = (p) => { try { return !!JSON.parse(p.metadata || '{}').lobby; } catch (e) { return false; } };
  let admitted = false;
  async function goLive() {
    if (admitted) return;
    admitted = true;
    joinedAt = Date.now();
    $('msg').style.display = 'none';
    try { await room.localParticipant.setMicrophoneEnabled(true); } catch (e) { toast('Microphone not allowed'); }
    try { await room.localParticipant.setCameraEnabled(true, { resolution: LK.VideoPresets.h360.resolution }); } catch (e) { toast('Camera not allowed'); }
    for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) if (pub.track) attachAudio(pub.track);
    draw();
    try { room.startAudio(); } catch (e) { }
  }

  $('qa').onclick = () => { if (qaOpen()) $('qaBox').style.display = 'none'; else openQa(); };
  $('qaClose').onclick = () => { $('qaBox').style.display = 'none'; };
  $('tabQ').onclick = () => { qaTab = 'q'; drawQa(); };
  $('tabP').onclick = () => { qaTab = 'p'; drawQa(); };
  $('tabC').onclick = () => { qaTab = 'c'; drawQa(); };
  $('qSend').onclick = () => {
    const text = $('qText').value.trim();
    if (!text) { toast('Type your question first'); return; }
    const q = { id: rid(), text, by: $('qAnon').checked ? '' : (P.n || ''), at: Date.now() };
    addQ(q);
    send({ ask: q });
    $('qText').value = '';
    toast('Question sent');
    drawQa();
  };
  $('pSend').onclick = () => {
    const q = $('pQ').value.trim();
    const opts = [...document.querySelectorAll('.pOpt')].map((i) => i.value.trim()).filter(Boolean);
    if (!q || opts.length < 2) { toast('Type the question and at least two options'); return; }
    let right = $('pRight').value;
    if (right !== '' && Number(right) >= opts.length) { toast('The correct answer must be one of the options'); return; }
    const x = { id: rid(), q, opts, right, at: Date.now() };
    addPoll(x);
    send({ poll: x });
    $('pQ').value = '';
    document.querySelectorAll('.pOpt').forEach((i) => { i.value = ''; });
    $('pRight').value = '';
    toast('Poll started');
    drawQa();
  };

  // ---------- leaving ----------

  function leave() {
    if (ended) return;
    ended = true;
    const minutes = joinedAt ? Math.max(1, Math.round((Date.now() - joinedAt) / 60000)) : 0;
    try { if (room) room.disconnect(); } catch (e) { }
    try { localStorage.setItem('medsphere_left', JSON.stringify({ room: P.r, minutes, at: Date.now() })); } catch (e) { }
    if (window.MedSphereApp && window.MedSphereApp.left) { window.MedSphereApp.left(P.r || '', minutes); return; }
    message('You left the meeting' + (minutes ? ' after ' + minutes + ' min' : '') + '.', 'Close', () => { window.close(); history.back(); });
  }

  // ---------- joining ----------

  async function join() {
    if (!LK || !P.u || !P.t || !P.k) {
      message('This meeting link is not complete. Open MedSphere from the TVMCHMED app.');
      return;
    }
    if (!LK.isE2EESupported()) {
      // privacy first: no meeting without end-to-end encryption
      message('This browser cannot encrypt the meeting end to end, so MedSphere will not join here. Use the TVMCHMED app, or Chrome or Edge on a computer.');
      return;
    }
    watermark();
    setInterval(watermark, 60000);
    const keyProvider = new LK.ExternalE2EEKeyProvider();
    await keyProvider.setKey(P.k);
    room = new LK.Room({
      adaptiveStream: true,
      dynacast: true,
      e2ee: { keyProvider, worker: new Worker('livekit-client.e2ee.worker.js') },
    });
    const E = LK.RoomEvent;
    for (const ev of [E.ParticipantConnected, E.ParticipantDisconnected, E.TrackSubscribed, E.TrackUnsubscribed, E.TrackMuted, E.TrackUnmuted,
      E.LocalTrackPublished, E.LocalTrackUnpublished, E.ActiveSpeakersChanged, E.ParticipantAttributesChanged, E.ParticipantNameChanged,
      E.ParticipantMetadataChanged, E.ParticipantPermissionsChanged])
      if (ev) room.on(ev, draw);
    room.on(E.TrackSubscribed, (track) => attachAudio(track));
    room.on(E.ParticipantConnected, (p) => { toast((p.name || 'Someone') + ' joined'); setTimeout(() => syncTo(p.identity), 1500); });
    room.on(E.DataReceived, (payload, participant) => {
      try {
        const d = JSON.parse(new TextDecoder().decode(payload));
        if (d.react) float(d.react);
        else onData(d, participant);
      } catch (e) { }
    });
    room.on(E.EncryptionError, () => toast('Encryption check failed for one stream: it is hidden'));
    room.on(E.Disconnected, () => { if (!ended && joinedAt) { toast('The meeting ended or you were removed'); leave(); } });
    try {
      await room.setE2EEEnabled(true);
      await room.connect(P.u, P.t);
    } catch (e) {
      message('Could not join: ' + (e && e.message ? e.message : e) + '. Check the internet and try again.', 'Try again', () => location.reload());
      return;
    }
    const perm = room.localParticipant.permissions;
    if (perm && perm.canSubscribe === false) {
      // waiting room: nothing is sent or received until a host lets this member in
      message('You are in the waiting room. The host will let you in shortly.', 'Leave', leave);
      room.on(E.ParticipantPermissionsChanged, (prev, p) => {
        const lp = room.localParticipant;
        if ((!p || p === lp) && lp.permissions && lp.permissions.canSubscribe) { toast('The host let you in'); goLive(); }
      });
      return;
    }
    goLive();
  }

  // ---------- the buttons ----------

  $('mic').onclick = async () => { await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled); draw(); };
  $('cam').onclick = async () => { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled); draw(); };
  if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) $('share').style.display = 'none';
  $('share').onclick = async () => {
    try {
      await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, { audio: false });
    } catch (e) {
      toast('Screen sharing was not started');
    }
    draw();
  };
  $('hand').onclick = async () => {
    handUp = !handUp;
    try { await room.localParticipant.setAttributes({ hand: handUp ? '1' : '' }); } catch (e) { }
    toast(handUp ? 'Hand raised: the host can see it' : 'Hand lowered');
    draw();
  };
  const REACTS = ['👍', '❤️', '🙏', '💡', '✅'];
  let ri = 0;
  $('react').onclick = async () => {
    const e = REACTS[ri++ % REACTS.length];
    $('react').textContent = REACTS[ri % REACTS.length];
    float(e);
    try { await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ react: e })), { reliable: true }); } catch (x) { }
  };
  $('ppl').onclick = () => {
    const box = $('people');
    $('qaBox').style.display = 'none';
    box.style.display = box.style.display === 'block' ? 'none' : 'block';
    if (box.style.display === 'block') people();
  };
  $('leave').onclick = leave;
  window.addEventListener('pagehide', () => { try { if (room && !ended) room.disconnect(); } catch (e) { } });
  // no right-click "save video", no dragging the picture out
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
  window.MedSphere = { leave };
  join();
})();
