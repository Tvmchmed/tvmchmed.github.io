/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary. See LICENSE.txt. */
/*
 * Walkie-talkie voice engine (11.2; whisper and live look 11.3): a page that holds the live, end-to-end encrypted line of one
 * channel on the MedSphere LiveKit server. Nothing is recorded or stored anywhere: voice and video go from phone to phone live.
 * The app's walkie screen draws the channel; this page talks, listens, and shows a live look full size when one is on.
 *   #u=<LiveKit url>&t=<pass>&k=<key>&n=<my name>&b=<1 roger beep>
 * Commands: Walkie.talk(on, to), Walkie.look(on, to), Walkie.beep(on), Walkie.leave()  (web: postMessage {walkieCmd, on, to})
 *   to = a member's id for a whisper / private look, '' for the whole channel.
 * Events to the app: WalkieApp.event(json) on Android, or parent.postMessage({walkie: event}) on the web:
 *   {type:'state', state:'connecting'|'live'|'error'|'ended', msg}
 *   {type:'people', list:[{id, name}]}            everyone else on the channel now
 *   {type:'talk', id, name, on, me, whisper}      someone pressed or let go (me: this phone; whisper: only to me / from me)
 *   {type:'level', v}                             voice level 0..1 of whoever is talking (about 12 times a second)
 *   {type:'busy', name}                           this phone pressed while someone else holds the channel
 *   {type:'look', on, me, name, id, private}      a live look started or ended (me: this phone is showing its camera)
 * Privacy: a whisper or a private look is limited by the LiveKit server itself (track subscription permissions), so the other
 * phones on the channel never receive it at all.
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
  try { history.replaceState(null, '', location.pathname); } catch (e) { }
  let room = null, ended = false, beepOn = P.b !== '0', talking = false, holder = null, holderName = '', holderAt = 0, levelTimer = null, ac = null;
  let whisperTo = '', lookTo = '', looking = false, lookTimer = null, lookLeft = 0, watching = null, facing = 'environment';
  const MAX_TALK_MS = 60000, LOOK_S = 30;
  let cut = null;

  function emit(o) {
    try {
      if (window.WalkieApp && window.WalkieApp.event) window.WalkieApp.event(JSON.stringify(o));
      else if (window.parent && window.parent !== window) window.parent.postMessage({ walkie: o }, location.origin);
    } catch (e) { }
  }

  // ---------- the roger beep: two short soft tones made here, never a file ----------
  function tone(freqs) {
    if (!beepOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      let t = ac.currentTime + 0.01;
      for (const f of freqs) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + 0.1);
        t += 0.1;
      }
    } catch (e) { }
  }

  function nameOf(id) {
    const p = room && room.remoteParticipants.get(id);
    return p ? (p.name || 'Member') : 'Member';
  }

  function people() {
    if (!room) return;
    const list = [];
    for (const p of room.remoteParticipants.values()) list.push({ id: p.identity, name: p.name || 'Member' });
    emit({ type: 'people', list });
  }

  async function send(obj, to) {
    try {
      const opt = { reliable: true };
      if (to) opt.destinationIdentities = [to];
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), opt);
    } catch (e) { }
  }

  /** Who may receive this phone's voice and camera: everyone, or only the whisper / look partner. Enforced by the server. */
  async function applyPerms() {
    if (!room) return;
    const lp = room.localParticipant;
    try {
      if (!whisperTo && !lookTo) { lp.setTrackSubscriptionPermissions(true, []); return; }
      const mic = lp.getTrackPublication(LK.Track.Source.Microphone);
      const cam = lp.getTrackPublication(LK.Track.Source.Camera);
      const perms = [];
      for (const p of room.remoteParticipants.values()) {
        const ok = [];
        if (mic && mic.trackSid && (!whisperTo || p.identity === whisperTo)) ok.push(mic.trackSid);
        if (cam && cam.trackSid && (!lookTo || p.identity === lookTo)) ok.push(cam.trackSid);
        perms.push({ participantIdentity: p.identity, allowAll: false, allowedTrackSids: ok });
      }
      lp.setTrackSubscriptionPermissions(false, perms);
    } catch (e) { }
  }

  function setHolder(id, name) {
    holder = id;
    holderName = name || '';
    holderAt = Date.now();
    clearInterval(levelTimer);
    levelTimer = null;
    if (id) {
      levelTimer = setInterval(() => {
        let v = 0;
        try {
          const p = id === 'me' ? room.localParticipant : room.remoteParticipants.get(id);
          v = p ? (p.audioLevel || 0) : 0;
        } catch (e) { }
        emit({ type: 'level', v: Math.min(1, v * 2.2) });
        // a phone that lost the line while talking frees the channel after a minute
        if (id !== 'me' && Date.now() - holderAt > MAX_TALK_MS + 5000) released(id, false);
      }, 80);
    } else emit({ type: 'level', v: 0 });
  }

  function released(id, whisper) {
    if (holder !== id) return;
    const name = holderName;
    setHolder(null, '');
    emit({ type: 'talk', id, name, on: false, me: false, whisper: !!whisper });
    tone([1400, 1000]);
  }

  async function talk(on, to) {
    if (!room || ended) return;
    if (on) {
      if (talking) return;
      to = to && room.remoteParticipants.get(to) ? to : '';
      if (!to && holder && holder !== 'me') { emit({ type: 'busy', name: holderName }); return; }
      talking = true;
      whisperTo = to;
      setHolder('me', P.n);
      tone(to ? [520] : [880]);
      emit({ type: 'talk', id: 'me', name: P.n, on: true, me: true, whisper: !!to });
      await applyPerms();   // a whisper: only that one phone may receive the voice, before the microphone opens
      send({ wt: 'talk', on: 1, w: to ? 1 : 0 }, to);
      try { await room.localParticipant.setMicrophoneEnabled(true); } catch (e) { emit({ type: 'state', state: 'error', msg: 'Microphone not allowed' }); }
      await applyPerms();
      clearTimeout(cut);
      cut = setTimeout(() => talk(false), MAX_TALK_MS);   // never an open microphone left on by mistake
    } else {
      if (!talking) return;
      talking = false;
      clearTimeout(cut);
      try { await room.localParticipant.setMicrophoneEnabled(false); } catch (e) { }
      const to = whisperTo;
      send({ wt: 'talk', on: 0, w: to ? 1 : 0 }, to);
      whisperTo = '';
      await applyPerms();   // the microphone is shut first, then the channel may hear this phone again
      setHolder(null, '');
      emit({ type: 'talk', id: 'me', name: P.n, on: false, me: true, whisper: !!to });
      tone([1200, 900]);
    }
  }

  // ---------- live look: up to 30 seconds of live camera, to the channel or one member ----------

  function clock(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function showPanel(who, mine) {
    $('look').style.display = 'block';
    $('who').textContent = who;
    $('stop').style.display = mine ? 'inline-block' : 'none';
    $('flip').style.display = mine ? 'inline-block' : 'none';
    $('wm').textContent = mine ? '' : (P.n || '') + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function hidePanel() {
    $('look').style.display = 'none';
    const v = $('vid');
    try { v.srcObject = null; } catch (e) { }
    try { for (const el of v.parentNode.querySelectorAll('video:not(#vid)')) el.remove(); } catch (e) { }
  }

  async function look(on, to) {
    if (!room || ended) return;
    if (on) {
      if (looking) return;
      to = to && room.remoteParticipants.get(to) ? to : '';
      looking = true;
      lookTo = to || '';
      if (to) lookTo = to; else lookTo = '';
      await applyPerms();   // a private look: only that phone may receive the camera, set before it opens
      try {
        await room.localParticipant.setCameraEnabled(true, { facingMode: facing, resolution: LK.VideoPresets.h540.resolution });
      } catch (e) {
        looking = false;
        lookTo = '';
        await applyPerms();
        emit({ type: 'state', state: 'error', msg: 'Camera not allowed' });
        emit({ type: 'look', on: false, me: true });
        return;
      }
      await applyPerms();
      const pub = room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
      if (pub && pub.track) pub.track.attach($('vid'));
      showPanel('📹 You → ' + (to ? nameOf(to) + ' only' : 'the channel'), true);
      send({ wt: 'look', on: 1, p: to ? 1 : 0 }, to);
      emit({ type: 'look', on: true, me: true, name: P.n, private: !!to });
      lookLeft = LOOK_S;
      $('time').textContent = clock(lookLeft);
      clearInterval(lookTimer);
      lookTimer = setInterval(() => {
        lookLeft--;
        $('time').textContent = clock(Math.max(0, lookLeft));
        if (lookLeft <= 0) look(false);
      }, 1000);
    } else {
      if (!looking) return;
      looking = false;
      clearInterval(lookTimer);
      try { await room.localParticipant.setCameraEnabled(false); } catch (e) { }
      try {
        const pub = room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
        if (pub && pub.track) await room.localParticipant.unpublishTrack(pub.track, true);
      } catch (e) { }
      const to = lookTo;
      send({ wt: 'look', on: 0 }, to);
      lookTo = '';
      await applyPerms();
      hidePanel();
      emit({ type: 'look', on: false, me: true });
    }
  }

  function watch(track, p) {
    if (looking) return;   // this phone is showing its own camera
    watching = p.identity;
    const v = $('vid');
    track.attach(v);
    showPanel('📹 Live look from ' + (p.name || 'Member'), false);
    const started = Date.now();
    clearInterval(lookTimer);
    lookTimer = setInterval(() => { $('time').textContent = clock(Math.floor((Date.now() - started) / 1000)); }, 1000);
    $('time').textContent = '0:00';
    emit({ type: 'look', on: true, me: false, id: p.identity, name: p.name || 'Member' });
    vibrate(60);
  }

  function unwatch(id) {
    if (!watching || (id && id !== watching)) return;
    watching = null;
    clearInterval(lookTimer);
    hidePanel();
    emit({ type: 'look', on: false, me: false, id });
  }

  function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } }

  async function leave() {
    if (ended) return;
    ended = true;
    try { if (talking) await talk(false); } catch (e) { }
    try { if (looking) await look(false); } catch (e) { }
    try { if (room) await room.disconnect(); } catch (e) { }
    emit({ type: 'state', state: 'ended' });
  }

  async function join() {
    if (!LK || !P.u || !P.t || !P.k) { emit({ type: 'state', state: 'error', msg: 'The channel pass is not complete' }); return; }
    if (!LK.isE2EESupported()) {
      emit({ type: 'state', state: 'error', msg: 'This browser cannot encrypt the voice end to end. Use the TVMCHMED app, or Chrome or Edge.' });
      return;
    }
    emit({ type: 'state', state: 'connecting' });
    const keyProvider = new LK.ExternalE2EEKeyProvider();
    await keyProvider.setKey(P.k);
    room = new LK.Room({
      e2ee: { keyProvider, worker: new Worker('livekit-client.e2ee.worker.js') },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const E = LK.RoomEvent;
    room.on(E.ParticipantConnected, () => { people(); applyPerms(); });
    room.on(E.ParticipantDisconnected, (p) => { if (p && holder === p.identity) released(p.identity, false); if (p) unwatch(p.identity); people(); });
    room.on(E.ParticipantNameChanged, people);
    room.on(E.TrackSubscribed, (track, pub, p) => {
      if (track.kind === 'audio') {
        const a = track.attach();
        a.style.display = 'none';
        document.body.appendChild(a);
      } else if (track.kind === 'video' && p) watch(track, p);
    });
    room.on(E.TrackUnsubscribed, (track, pub, p) => { if (track.kind === 'video' && p) unwatch(p.identity); });
    room.on(E.TrackMuted, (pub, p) => { if (pub && pub.kind === 'video' && p && p !== room.localParticipant) unwatch(p.identity); });
    room.on(E.DataReceived, (payload, p) => {
      if (!p) return;
      try {
        const d = JSON.parse(new TextDecoder().decode(payload));
        if (d.wt === 'look') {
          if (!d.on) unwatch(p.identity);
          return;
        }
        if (d.wt !== 'talk') return;
        const w = !!d.w;
        if (d.on) {
          if (talking && !w && !whisperTo) {
            // both pressed at once: the earlier id in the alphabet keeps the channel, the other lets go
            if ((p.identity || '') < (room.localParticipant.identity || '')) { talk(false); emit({ type: 'busy', name: p.name || 'Member' }); } else return;
          }
          setHolder(p.identity, p.name || 'Member');
          emit({ type: 'talk', id: p.identity, name: p.name || 'Member', on: true, me: false, whisper: w });
          tone(w ? [520] : [660]);
          if (w) vibrate(80);
        } else released(p.identity, w);
      } catch (e) { }
    });
    room.on(E.EncryptionError, () => emit({ type: 'state', state: 'error', msg: 'Encryption check failed for one voice' }));
    room.on(E.Disconnected, () => { if (!ended) { ended = true; emit({ type: 'state', state: 'ended' }); } });
    room.on(E.Reconnecting, () => emit({ type: 'state', state: 'connecting' }));
    room.on(E.Reconnected, () => { emit({ type: 'state', state: 'live' }); people(); applyPerms(); });
    try {
      await room.setE2EEEnabled(true);
      await room.connect(P.u, P.t);
    } catch (e) {
      emit({ type: 'state', state: 'error', msg: 'Could not connect: ' + (e && e.message ? e.message : e) });
      return;
    }
    // warm up the microphone once, then mute it: pressing the button is then instant
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch (e) { }
    for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) {
      if (!pub.track) continue;
      if (pub.track.kind === 'audio') { const a = pub.track.attach(); a.style.display = 'none'; document.body.appendChild(a); }
      else if (pub.track.kind === 'video') watch(pub.track, p);
    }
    try { await room.startAudio(); } catch (e) { }
    emit({ type: 'state', state: 'live' });
    people();
  }

  $('stop').onclick = () => look(false);
  $('flip').onclick = async () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    try {
      const pub = room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
      if (pub && pub.track && pub.track.restartTrack) await pub.track.restartTrack({ facingMode: facing });
    } catch (e) { }
  };
  // no saving the picture: no right-click, no dragging it out
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || !e.data.walkieCmd) return;
    const c = e.data.walkieCmd;
    if (c === 'talk') talk(!!e.data.on, e.data.to || '');
    else if (c === 'look') look(!!e.data.on, e.data.to || '');
    else if (c === 'beep') beepOn = !!e.data.on;
    else if (c === 'leave') leave();
    else if (c === 'audio') { try { room && room.startAudio(); } catch (x) { } }
  });
  window.addEventListener('pagehide', () => { try { if (room && !ended) room.disconnect(); } catch (e) { } });
  window.Walkie = { talk, look, leave, beep: (on) => { beepOn = !!on; } };
  join();
})();
