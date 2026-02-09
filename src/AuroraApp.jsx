import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import * as Tone from "tone";

/* ═══════════════════════════════════════════
   DATA ENGINE — LIVE NOAA 7-DAY TIMELINE
   ═══════════════════════════════════════════
   Fetches a rolling 7-day window from NOAA SWPC.
   Plays through the timeline at ~2s per real data point.
   When it reaches the end, re-fetches fresh data.
   Falls back to simulated data if fetch fails.
   ═══════════════════════════════════════════ */

const NOAA_URLS = {
  plasma: "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json",
  mag: "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  xray: "https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json",
};

// Parse NOAA JSON into unified timeline array
function parseNOAAData(plasma, mag, kp, xray) {
  // plasma: [["time_tag","density","speed","temperature"], ["2025-02-01 00:00:00","5.2","420.1","98000"], ...]
  // mag:    [["time_tag","bx_gsm","by_gsm","bz_gsm","bt"], ["2025-02-01 00:00:00","1.2","-3.4","2.1","4.5"], ...]
  // kp:     [["time_tag","kp_index",...], ["2025-02-01 00:00:00","3.00",...], ...]
  // xray:   [{"time_tag":"...","flux":1.23e-7,...}, ...]

  // Build time-indexed maps for mag, kp, xray
  const magMap = new Map();
  for (let i = 1; i < mag.length; i++) {
    const r = mag[i];
    if (!r || !r[0]) continue;
    const key = r[0].substring(0, 16); // "2025-02-01 00:00"
    magMap.set(key, {
      bx: parseFloat(r[1]) || 0,
      by: parseFloat(r[2]) || 0,
      bz: parseFloat(r[3]) || 0,
      bt: parseFloat(r[4]) || 0,
    });
  }

  const kpMap = new Map();
  for (let i = 1; i < kp.length; i++) {
    const r = kp[i];
    if (!r || !r[0]) continue;
    const key = r[0].substring(0, 16);
    kpMap.set(key, parseFloat(r[1]) || 0);
  }

  // xray is objects, not arrays
  const xrayMap = new Map();
  if (Array.isArray(xray)) {
    for (const r of xray) {
      if (!r || !r.time_tag) continue;
      const key = r.time_tag.substring(0, 16);
      xrayMap.set(key, parseFloat(r.flux) || 0);
    }
  }

  // Build timeline from plasma (most frequent readings)
  const timeline = [];
  let lastKp = 2;
  let lastXray = 1e-7;

  for (let i = 1; i < plasma.length; i++) {
    const r = plasma[i];
    if (!r || !r[0]) continue;

    const timeStr = r[0];
    const key = timeStr.substring(0, 16);
    const speed = parseFloat(r[2]) || 400;
    const density = parseFloat(r[1]) || 5;
    const temp = parseFloat(r[3]) || 100000;

    // Find closest mag reading
    const m = magMap.get(key) || { bx: 0, by: 0, bz: 0, bt: 5 };

    // Kp updates less frequently — carry forward
    if (kpMap.has(key)) lastKp = kpMap.get(key);
    // Same for xray
    if (xrayMap.has(key)) lastXray = xrayMap.get(key);

    timeline.push({
      time: timeStr,
      speed, density, temp,
      bt: m.bt, bz: m.bz, bx: m.bx, by: m.by,
      kp: lastKp,
      xray: lastXray,
    });
  }

  return timeline;
}

// Simulated fallback — generates a realistic 7-day timeline
function generateSimulatedTimeline() {
  const points = 5000;
  const timeline = [];
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Create a few "storm events" for drama
  const storms = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => ({
    center: Math.random() * points,
    width: 60 + Math.random() * 200,
    intensity: 0.5 + Math.random() * 0.5,
  }));

  let speed = 380, density = 5, temp = 120000, bt = 6, bz = 1, bx = 0, by = 2, kp = 2, xray = 2e-7;

  for (let i = 0; i < points; i++) {
    const t = i / points;
    const date = new Date(weekAgo.getTime() + t * 7 * 24 * 60 * 60 * 1000);

    // Storm influence
    let stormFactor = 0;
    for (const s of storms) {
      const dist = Math.abs(i - s.center) / s.width;
      if (dist < 1) stormFactor = Math.max(stormFactor, (1 - dist * dist) * s.intensity);
    }

    // Evolve with random walk + storm influence
    speed += (Math.random() - 0.48) * 8 + stormFactor * 15;
    speed = Math.max(280, Math.min(900, speed));
    density += (Math.random() - 0.48) * 0.8 + stormFactor * 2;
    density = Math.max(0.5, Math.min(40, density));
    temp += (Math.random() - 0.5) * 8000;
    temp = Math.max(20000, Math.min(500000, temp));
    bt += (Math.random() - 0.48) * 0.6 + stormFactor * 1.5;
    bt = Math.max(1, Math.min(35, bt));
    bz += (Math.random() - 0.52) * 1.2 - stormFactor * 2;
    bz = Math.max(-25, Math.min(15, bz));
    bx += (Math.random() - 0.5) * 0.8;
    bx = Math.max(-12, Math.min(12, bx));
    by += (Math.random() - 0.5) * 0.8;
    by = Math.max(-12, Math.min(12, by));
    kp += (Math.random() - 0.48) * 0.15 + stormFactor * 0.4;
    kp = Math.max(0, Math.min(9, kp));
    xray += (Math.random() - 0.48) * 1e-7 + stormFactor * 3e-7;
    xray = Math.max(1e-8, Math.min(1e-4, xray));

    const timeStr = date.toISOString().replace("T", " ").substring(0, 19);
    timeline.push({ time: timeStr, speed, density, temp, bt, bz, bx, by, kp, xray });
  }

  return timeline;
}

// Timeline player class — manages playback position and interpolation
class TimelinePlayer {
  constructor() {
    this.timeline = [];
    this.index = 0;
    this.isLive = false;
    this.loading = true;
    this.error = null;
    this.currentTime = "";
    this.progress = 0;
    this.paused = false;
  }

  async fetchLive() {
    this.loading = true;
    this.error = null;
    try {
      const [plasmaRes, magRes, kpRes, xrayRes] = await Promise.all([
        fetch(NOAA_URLS.plasma), fetch(NOAA_URLS.mag), fetch(NOAA_URLS.kp), fetch(NOAA_URLS.xray),
      ]);
      if (!plasmaRes.ok || !magRes.ok) throw new Error("NOAA API unavailable");
      const [plasma, mag, kp, xray] = await Promise.all([
        plasmaRes.json(), magRes.json(), kpRes.json(), xrayRes.json(),
      ]);
      const tl = parseNOAAData(plasma, mag, kp, xray);
      if (tl.length < 100) throw new Error("Insufficient data");
      this.timeline = tl;
      this.isLive = true;
      this.index = 0;
      this.loading = false;
      return true;
    } catch (e) {
      console.warn("NOAA fetch failed, using simulated data:", e.message);
      this.timeline = generateSimulatedTimeline();
      this.isLive = false;
      this.index = 0;
      this.loading = false;
      this.error = e.message;
      return false;
    }
  }

  // Get current data point, interpolated between index and index+1
  getCurrent(fraction = 0) {
    if (this.timeline.length === 0) return null;
    const i = Math.min(this.index, this.timeline.length - 1);
    const a = this.timeline[i];
    const b = this.timeline[Math.min(i + 1, this.timeline.length - 1)];
    const t = fraction; // 0-1 between current and next point

    const lerp = (v1, v2) => v1 + (v2 - v1) * t;

    this.currentTime = a.time;
    this.progress = this.index / Math.max(1, this.timeline.length - 1);

    return {
      latest: {
        speed: lerp(a.speed, b.speed),
        density: lerp(a.density, b.density),
        temp: lerp(a.temp, b.temp),
        bt: lerp(a.bt, b.bt),
        bz: lerp(a.bz, b.bz),
        kp: lerp(a.kp, b.kp),
      },
      xray_values: [a.xray, lerp(a.xray, b.xray)],
      currentTime: a.time,
      progress: this.progress,
      isLive: this.isLive,
      totalPoints: this.timeline.length,
      index: this.index,
    };
  }

  // Advance to next data point. Returns true if looped.
  advance() {
    if (this.paused) return false;
    this.index++;
    if (this.index >= this.timeline.length - 1) {
      this.index = 0;
      return true; // Signal to re-fetch
    }
    return false;
  }

  // Seek to a position (0-1 fraction of timeline)
  seekTo(fraction) {
    const idx = Math.floor(Math.max(0, Math.min(1, fraction)) * (this.timeline.length - 1));
    this.index = idx;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }
}

/* ═══════════════════════════════════════════
   SONIFICATION ENGINE (improved)
   ═══════════════════════════════════════════ */
class SonEngine {
  constructor() { this.on = false; }

  async start() {
    if (this.on) return;
    await Tone.start();
    Tone.getTransport().bpm.value = 60;

    this.master = new Tone.Gain(0.2).toDestination();
    this.reverb = new Tone.Reverb({ decay: 8, wet: 0.55 }).connect(this.master);
    this.delay = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.25, wet: 0.18 }).connect(this.reverb);
    this.chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 12, depth: 0.6, wet: 0.3 }).connect(this.reverb);

    // Breathing LFO on master
    this.breathLFO = new Tone.LFO({ frequency: 0.08, min: 0.15, max: 0.3 }).start();
    this.breathLFO.connect(this.master.gain);

    // Wind drone — rich FM
    this.wind = new Tone.FMSynth({
      harmonicity: 2, modulationIndex: 3,
      oscillator: { type: "sine" }, modulation: { type: "triangle" },
      envelope: { attack: 4, decay: 2, sustain: 0.7, release: 6 },
      modulationEnvelope: { attack: 2, decay: 1, sustain: 0.5, release: 4 },
      volume: -20,
    }).connect(this.chorus);

    // Bz atmosphere — poly pad
    this.bzPad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine8" },
      envelope: { attack: 4, decay: 3, sustain: 0.6, release: 6 },
      volume: -24,
    }).connect(this.reverb);

    // Density plucks — pentatonic
    this.pluck = new Tone.PluckSynth({
      attackNoise: 0.8, dampening: 2500, resonance: 0.96, volume: -18,
    }).connect(this.delay);

    // Solar hiss — filtered noise
    this.noiseFilter = new Tone.AutoFilter({ frequency: 0.15, baseFrequency: 150, octaves: 5, wet: 1 }).connect(this.reverb).start();
    this.noise = new Tone.Noise({ type: "pink", volume: -34 }).connect(this.noiseFilter);
    this.noise.start();

    // X-ray bells
    this.bell = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.005, decay: 2.5, sustain: 0, release: 2 },
      volume: -22,
    }).connect(this.delay);

    // Kp sub rumble
    this.sub = new Tone.MembraneSynth({
      pitchDecay: 0.08, octaves: 5,
      envelope: { attack: 0.01, decay: 1.2, sustain: 0, release: 1.5 },
      volume: -22,
    }).connect(this.master);

    // Shimmer for high activity
    this.shimmer = new Tone.FMSynth({
      harmonicity: 8, modulationIndex: 12,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.5, decay: 1, sustain: 0.2, release: 3 },
      volume: -30,
    }).connect(this.reverb);

    this.on = true;
    this._lastPluck = 0;
    this._lastBell = 0;
  }

  update(d) {
    if (!this.on || !d) return;
    const l = d.latest;
    const sN = Math.min(1, (l.speed || 400) / 900);
    const dN = Math.min(1, (l.density || 5) / 20);
    const bzN = Math.max(-1, Math.min(1, (l.bz || 0) / 15));
    const btN = Math.min(1, (l.bt || 5) / 25);
    const kpN = Math.min(1, (l.kp || 2) / 9);
    const now = Tone.now();

    try { this.wind.setNote(35 + sN * 65); } catch (e) {
      try { this.wind.triggerAttack(35 + sN * 65, now); } catch (e2) {}
    }

    // Bz chords
    try {
      this.bzPad.releaseAll(now);
      const root = 175 + bzN * 40;
      if (bzN < -0.3) {
        this.bzPad.triggerAttack([root, root * 1.189, root * 1.414, root * 1.682], now);
      } else if (bzN < 0.1) {
        this.bzPad.triggerAttack([root, root * 1.189, root * 1.498], now);
      } else {
        this.bzPad.triggerAttack([root, root * 1.26, root * 1.5, root * 2], now);
      }
    } catch (e) {}

    // Plucks — pentatonic scale
    if (now - this._lastPluck > 0.3 / (0.2 + dN)) {
      const notes = ["C3","D3","E3","G3","A3","C4","D4","E4","G4","A4","C5"];
      const note = notes[Math.floor(Math.random() * notes.length)];
      try { this.pluck.triggerAttack(note, now); } catch (e) {}
      this._lastPluck = now;
    }

    // Noise
    try {
      this.noiseFilter.baseFrequency = 80 + btN * 2500;
      this.noise.volume.rampTo(-38 + btN * 18, 2);
    } catch (e) {}

    // X-ray bells
    const xv = d.xray_values?.[d.xray_values.length - 1] || 0;
    if (xv > 4e-7 && now - this._lastBell > 1.5) {
      const bellNotes = ["E5","G5","B5","D6","F#6"];
      try { this.bell.triggerAttackRelease(bellNotes[Math.floor(Math.random() * bellNotes.length)], "2n", now); } catch (e) {}
      this._lastBell = now;
    }

    // Kp rumble
    if (kpN > 0.35 && Math.random() < kpN * 0.25) {
      try { this.sub.triggerAttackRelease(25 + kpN * 25, "4n", now); } catch (e) {}
    }

    // Shimmer on high activity
    if (sN + btN + kpN > 1.8 && Math.random() < 0.15) {
      try { this.shimmer.triggerAttackRelease(800 + Math.random() * 1200, "2n", now, 0.02); } catch (e) {}
    }

    // Breathing depth based on activity
    try { this.breathLFO.min = 0.1 + (sN + kpN) * 0.05; this.breathLFO.max = 0.2 + (sN + kpN) * 0.1; } catch (e) {}
  }

  stop() {
    if (!this.on) return;
    try {
      [this.wind, this.bzPad, this.pluck, this.noise, this.bell, this.sub, this.shimmer,
       this.noiseFilter, this.chorus, this.delay, this.reverb, this.breathLFO, this.master]
        .forEach(x => { try { x?.dispose(); } catch (e) {} });
    } catch (e) {}
    this.on = false;
  }
}

/* ═══════════════════════════════════════════
   AURORA VERTEX SHADER — curtain ribbons
   ═══════════════════════════════════════════ */
const auroraVertexShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uBz;
  uniform float uSpeed;
  attribute float aPhase;
  attribute float aBand;
  attribute float aHeight;
  varying float vAlt;
  varying float vBand;
  varying float vIntensity;
  varying float vEdge;

  void main() {
    vBand = aBand;
    vIntensity = uIntensity;

    vec3 pos = position;

    // Vertical ray structure — particles cluster into vertical columns
    float col = floor(pos.x / 18.0);
    float colPhase = col * 1.7 + uTime * 0.5;
    float rayBrightness = 0.4 + 0.6 * pow(abs(sin(colPhase)), 3.0);

    // Curtain wave — large-scale ripple
    float wave = sin(pos.x * 0.004 + uTime * 0.8 + aBand * 1.5) * 40.0 * uIntensity;
    float wave2 = sin(pos.x * 0.01 + uTime * 1.2) * 15.0 * uIntensity;
    pos.z += wave + wave2;

    // Vertical flow
    pos.y += aHeight * (0.5 + uIntensity * 1.5);
    pos.y += sin(uTime * 2.0 + aPhase) * 8.0 * uIntensity;

    // Sway with speed
    pos.x += sin(uTime * 0.3 + pos.y * 0.005) * uSpeed * 30.0;

    vAlt = clamp((pos.y - 80.0) / 500.0, 0.0, 1.0);
    vEdge = rayBrightness;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = min((4.0 + uIntensity * 6.0) * rayBrightness * (300.0 / -mvPos.z), 28.0);
  }
`;

const auroraFragmentShader = `
  uniform float uBz;
  uniform float uIntensity;
  varying float vAlt;
  varying float vBand;
  varying float vEdge;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d);

    vec3 col;
    float storm = clamp(-uBz, 0.0, 1.0);

    // Lower altitude: green, upper: blue/purple, storm: red/magenta
    vec3 greenBase = vec3(0.15, 1.0, 0.4);
    vec3 blueTop = vec3(0.3, 0.4, 1.0);
    vec3 redStorm = vec3(1.0, 0.2, 0.35);
    vec3 purpleStorm = vec3(0.8, 0.15, 1.0);

    vec3 quiet = mix(greenBase, blueTop, vAlt);
    vec3 stormy = mix(redStorm, purpleStorm, vAlt);
    col = mix(quiet, stormy, storm * 0.8);

    // Brighten with intensity
    col += vec3(0.15) * uIntensity;

    alpha *= (0.5 + uIntensity * 0.5) * vEdge;
    alpha *= 0.6 + vAlt * 0.3;
    alpha = clamp(alpha, 0.0, 0.85);

    gl_FragColor = vec4(col, alpha);
  }
`;

/* (atmosphere removed — ground-level view) */

/* ═══════════════════════════════════════════
   CAMERA PRESETS
   ═══════════════════════════════════════════ */
const CAMERAS = {
  orbit: { name: "Orbital", desc: "Free orbit around Earth", pos: [0, 300, 600], lookAt: [0, 150, 0] },
  iss: { name: "ISS View", desc: "Low orbit, looking down", pos: [200, 500, 300], lookAt: [0, 100, -100] },
  ground: { name: "Ground", desc: "Looking up from surface", pos: [0, 15, 250], lookAt: [0, 400, -200] },
  polar: { name: "Polar", desc: "Top-down over the pole", pos: [0, 900, 50], lookAt: [0, 0, 0] },
  cinematic: { name: "Cinematic", desc: "Slow sweep", pos: [-400, 200, 400], lookAt: [0, 250, 0] },
};

/* ═══════════════════════════════════════════
   THREE.JS SCENE BUILDER
   ═══════════════════════════════════════════ */
function buildScene(container, dataRef, cameraPresetRef) {
  const W = container.clientWidth, H = container.clientHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010104);

  const camera = new THREE.PerspectiveCamera(60, W / H, 1, 8000);
  camera.position.set(0, 300, 600);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // ─── Trail + Bloom via ping-pong render targets ───
  const rtOpts = { format: THREE.RGBAFormat, type: THREE.HalfFloatType };
  const sceneRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const trailRT_A = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const trailRT_B = new THREE.WebGLRenderTarget(W, H, rtOpts);
  let trailRead = trailRT_A, trailWrite = trailRT_B;

  const compScene = new THREE.Scene();
  const compCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);

  // Trail accumulation: blend previous frame (faded) with new frame
  const trailMat = new THREE.ShaderMaterial({
    uniforms: {
      tNew: { value: null },
      tPrev: { value: null },
      uFade: { value: 0.92 },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
    fragmentShader: `
      uniform sampler2D tNew;
      uniform sampler2D tPrev;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        vec4 newCol = texture2D(tNew, vUv);
        vec4 prevCol = texture2D(tPrev, vUv) * uFade;
        // Simple max blend — take whichever is brighter, no additive stacking
        gl_FragColor = max(newCol, prevCol);
      }
    `,
  });
  const trailQuad = new THREE.Mesh(quadGeo.clone(), trailMat);
  const trailScene = new THREE.Scene();
  trailScene.add(trailQuad);

  // Bloom: soft glow on the accumulated result
  const bloomMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uBloomStrength: { value: 0.8 },
      uResolution: { value: new THREE.Vector2(W, H) },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uBloomStrength;
      uniform vec2 uResolution;
      varying vec2 vUv;
      void main() {
        vec4 col = texture2D(tDiffuse, vUv);
        vec4 bloom = vec4(0.0);
        float total = 0.0;
        for (int x = -4; x <= 4; x++) {
          for (int y = -4; y <= 4; y++) {
            float w = 1.0 / (1.0 + float(x*x + y*y) * 0.5);
            vec2 offset = vec2(float(x), float(y)) / uResolution * 4.0;
            bloom += texture2D(tDiffuse, vUv + offset) * w;
            total += w;
          }
        }
        bloom /= total;
        vec4 brightPass = max(bloom - 0.35, 0.0) * 1.2;
        gl_FragColor = col + brightPass * uBloomStrength;
      }
    `,
    transparent: false,
  });
  const bloomQuad = new THREE.Mesh(quadGeo.clone(), bloomMat);
  const bloomScene = new THREE.Scene();
  const bloomCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  bloomScene.add(bloomQuad);

  // ─── Stars (layered) ───
  const addStars = (count, size, opacity) => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 6000;
      p[i * 3 + 1] = 50 + Math.random() * 3000;
      p[i * 3 + 2] = (Math.random() - 0.5) * 6000;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size, transparent: true, opacity, sizeAttenuation: true, depthWrite: false });
    scene.add(new THREE.Points(g, m));
  };
  addStars(4000, 1, 0.5);
  addStars(1000, 2.5, 0.8);
  addStars(200, 4, 1);

  // ─── Ground — dark wireframe terrain only ───
  const groundGeo = new THREE.PlaneGeometry(5000, 5000, 80, 80);
  const gArr = groundGeo.attributes.position.array;
  for (let i = 0; i < gArr.length; i += 3) {
    gArr[i + 2] = Math.random() * 6 + Math.sin(gArr[i] * 0.008) * 12 + Math.cos(gArr[i + 1] * 0.006) * 8;
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({
    color: 0x080818, wireframe: true, transparent: true, opacity: 0.08,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -30;
  scene.add(ground);

  // ─── Aurora curtain (shader particles) ───
  const AURORA_COUNT = 40000;
  const aGeo = new THREE.BufferGeometry();
  const aPos = new Float32Array(AURORA_COUNT * 3);
  const aPhase = new Float32Array(AURORA_COUNT);
  const aBand = new Float32Array(AURORA_COUNT);
  const aHeight = new Float32Array(AURORA_COUNT);

  for (let i = 0; i < AURORA_COUNT; i++) {
    const band = Math.floor(Math.random() * 6);
    aBand[i] = band;
    const bandZ = (band - 2.5) * 80;
    aPos[i * 3] = (Math.random() - 0.5) * 2400;
    aPos[i * 3 + 1] = 60 + Math.random() * 450;
    aPos[i * 3 + 2] = -200 + bandZ + (Math.random() - 0.5) * 50;
    aPhase[i] = Math.random() * Math.PI * 2;
    aHeight[i] = Math.random();
  }
  aGeo.setAttribute("position", new THREE.BufferAttribute(aPos, 3));
  aGeo.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
  aGeo.setAttribute("aBand", new THREE.BufferAttribute(aBand, 1));
  aGeo.setAttribute("aHeight", new THREE.BufferAttribute(aHeight, 1));

  const aMat = new THREE.ShaderMaterial({
    vertexShader: auroraVertexShader,
    fragmentShader: auroraFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.5 },
      uBz: { value: 0 },
      uSpeed: { value: 0.5 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const aurora = new THREE.Points(aGeo, aMat);
  scene.add(aurora);

  // ─── Solar wind streams ───
  const STREAM_COUNT = 6000;
  const stGeo = new THREE.BufferGeometry();
  const stPos = new Float32Array(STREAM_COUNT * 3);
  const stCol = new Float32Array(STREAM_COUNT * 3);
  const stVel = new Float32Array(STREAM_COUNT);
  for (let i = 0; i < STREAM_COUNT; i++) {
    stPos[i * 3] = (Math.random() - 0.5) * 2500;
    stPos[i * 3 + 1] = Math.random() * 900;
    stPos[i * 3 + 2] = -2000 + Math.random() * 4000;
    stVel[i] = 0.5 + Math.random() * 2.5;
    stCol[i * 3] = 0.25 + Math.random() * 0.15;
    stCol[i * 3 + 1] = 0.08 + Math.random() * 0.08;
    stCol[i * 3 + 2] = 0.45 + Math.random() * 0.25;
  }
  stGeo.setAttribute("position", new THREE.BufferAttribute(stPos, 3));
  stGeo.setAttribute("color", new THREE.BufferAttribute(stCol, 3));
  const stMat = new THREE.PointsMaterial({
    size: 1.8, vertexColors: true, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false,
  });
  const streams = new THREE.Points(stGeo, stMat);
  scene.add(streams);

  // ─── Magnetic field lines ───
  const fieldLines = [];
  for (let fl = 0; fl < 10; fl++) {
    const pts = Array.from({ length: 16 }, (_, i) => {
      const t = i / 15;
      return new THREE.Vector3(
        (fl - 4.5) * 130 + Math.sin(t * Math.PI) * 60,
        Math.sin(t * Math.PI) * 450 + 20,
        -250 + t * 150
      );
    });
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeGeo = new THREE.TubeGeometry(curve, 40, 0.6, 3, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0x44ccaa, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    fieldLines.push({ mesh: tube, base: pts.map(p => p.clone()) });
    scene.add(tube);
  }

  // ─── Shooting stars ───
  const shootingStars = [];
  const addShootingStar = () => {
    const g = new THREE.BufferGeometry();
    const len = 30;
    const p = new Float32Array(len * 3);
    const start = new THREE.Vector3((Math.random()-0.5)*3000, 800+Math.random()*1000, (Math.random()-0.5)*3000);
    const dir = new THREE.Vector3((Math.random()-0.5)*2, -1-Math.random(), (Math.random()-0.5)*2).normalize();
    for (let i = 0; i < len; i++) {
      const pt = start.clone().addScaledVector(dir, i * 8);
      p[i*3]=pt.x; p[i*3+1]=pt.y; p[i*3+2]=pt.z;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const mesh = new THREE.Points(g, m);
    scene.add(mesh);
    shootingStars.push({ mesh, life: 1, decay: 0.015 + Math.random() * 0.02 });
  };

  // ─── Lighting ───
  scene.add(new THREE.AmbientLight(0x111122, 0.4));
  const sunLight = new THREE.DirectionalLight(0xffeedd, 0.3);
  sunLight.position.set(500, 300, -800);
  scene.add(sunLight);

  // ─── Smooth state ───
  const sm = { speed: 0.5, density: 0.5, bz: 0, bt: 0.3, kp: 0.3 };
  let time = 0, mouseX = 0, mouseY = 0;
  const camTarget = { x: 0, y: 300, z: 600, lx: 0, ly: 150, lz: 0 };
  const camCurrent = { ...camTarget };

  const onMM = e => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener("mousemove", onMM);

  let animId;
  const animate = () => {
    animId = requestAnimationFrame(animate);
    time += 0.004;
    const d = dataRef.current;
    if (!d) return;
    const l = d.latest;

    sm.speed += (Math.min(1, (l.speed||400)/900) - sm.speed) * 0.015;
    sm.density += (Math.min(1, (l.density||5)/20) - sm.density) * 0.015;
    sm.bz += (Math.max(-1, Math.min(1, (l.bz||0)/15)) - sm.bz) * 0.015;
    sm.bt += (Math.min(1, (l.bt||5)/25) - sm.bt) * 0.015;
    sm.kp += (Math.min(1, (l.kp||2)/9) - sm.kp) * 0.015;

    const intensity = Math.max(0.15, (sm.kp + sm.bt + Math.max(0, -sm.bz)) / 2.5);

    // ─── Camera ───
    const preset = CAMERAS[cameraPresetRef.current] || CAMERAS.orbit;
    const [px, py, pz] = preset.pos;
    const [lx, ly, lz] = preset.lookAt;

    if (cameraPresetRef.current === "orbit") {
      const a = time * 0.12 + mouseX * 0.4;
      camTarget.x = Math.sin(a) * 550 + mouseX * 60;
      camTarget.z = Math.cos(a) * 550;
      camTarget.y = 180 + mouseY * -50 + sm.kp * 100;
      camTarget.lx = 0; camTarget.ly = 180 + sm.kp * 80; camTarget.lz = -80;
    } else if (cameraPresetRef.current === "cinematic") {
      const a = time * 0.05;
      camTarget.x = Math.sin(a) * 700;
      camTarget.z = Math.cos(a) * 400;
      camTarget.y = 200 + Math.sin(time * 0.15) * 80;
      camTarget.lx = 0; camTarget.ly = 250; camTarget.lz = 0;
    } else {
      camTarget.x = px + mouseX * 30;
      camTarget.y = py + mouseY * -20;
      camTarget.z = pz;
      camTarget.lx = lx; camTarget.ly = ly; camTarget.lz = lz;
    }

    camCurrent.x += (camTarget.x - camCurrent.x) * 0.02;
    camCurrent.y += (camTarget.y - camCurrent.y) * 0.02;
    camCurrent.z += (camTarget.z - camCurrent.z) * 0.02;
    camCurrent.lx += (camTarget.lx - camCurrent.lx) * 0.02;
    camCurrent.ly += (camTarget.ly - camCurrent.ly) * 0.02;
    camCurrent.lz += (camTarget.lz - camCurrent.lz) * 0.02;

    camera.position.set(camCurrent.x, camCurrent.y, camCurrent.z);
    camera.lookAt(camCurrent.lx, camCurrent.ly, camCurrent.lz);

    // ─── Aurora shader ───
    aMat.uniforms.uTime.value = time * 8;
    aMat.uniforms.uIntensity.value = intensity;
    aMat.uniforms.uBz.value = sm.bz;
    aMat.uniforms.uSpeed.value = sm.speed;

    // ─── Solar wind streams ───
    const sp = stGeo.attributes.position.array;
    const sc = stGeo.attributes.color.array;
    for (let i = 0; i < STREAM_COUNT; i++) {
      sp[i*3+2] += stVel[i] * (0.5 + sm.speed * 5);
      sp[i*3+1] += Math.sin(time * 8 + i * 0.1) * 0.15;
      if (sp[i*3+2] > 2000) { sp[i*3+2] = -2000; sp[i*3] = (Math.random()-0.5)*2500; sp[i*3+1] = Math.random()*900; }
      sc[i*3] = 0.2 + sm.speed * 0.35;
      sc[i*3+2] = 0.35 + sm.density * 0.35;
    }
    stGeo.attributes.position.needsUpdate = true;
    stGeo.attributes.color.needsUpdate = true;
    stMat.opacity = 0.15 + sm.speed * 0.3;

    // ─── Field lines ───
    fieldLines.forEach((fl, fi) => {
      const np = fl.base.map((bp, pi) => {
        const t = pi / (fl.base.length - 1);
        return new THREE.Vector3(
          bp.x + Math.sin(time * 6 + fi + t * 3) * sm.bt * 35,
          bp.y * (0.8 + intensity * 0.5) + Math.cos(time * 4 + fi * 0.5) * 12,
          bp.z + Math.cos(time * 5 + fi) * sm.bt * 20
        );
      });
      const nc = new THREE.CatmullRomCurve3(np);
      const ng = new THREE.TubeGeometry(nc, 40, 0.4 + intensity * 1.8, 3, false);
      fl.mesh.geometry.dispose();
      fl.mesh.geometry = ng;
      fl.mesh.material.opacity = 0.06 + intensity * 0.18;
      fl.mesh.material.color.setHSL(0.35 + sm.bz * 0.12, 0.5, 0.5);
    });

    // ─── Shooting stars ───
    if (Math.random() < 0.01 + sm.kp * 0.03) addShootingStar();
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const ss = shootingStars[i];
      ss.life -= ss.decay;
      ss.mesh.material.opacity = ss.life;
      if (ss.life <= 0) { scene.remove(ss.mesh); ss.mesh.geometry.dispose(); ss.mesh.material.dispose(); shootingStars.splice(i, 1); }
    }

    // ─── Background ───
    const bgR = 0.004 + Math.max(0, -sm.bz) * 0.02;
    const bgB = 0.016 + sm.speed * 0.015;
    scene.background.setRGB(bgR, 0.004, bgB);

    // ─── Render: scene → trail accumulation → bloom ───
    // 1. Render scene to sceneRT
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    // 2. Trail accumulation: blend new frame with faded previous
    trailMat.uniforms.tNew.value = sceneRT.texture;
    trailMat.uniforms.tPrev.value = trailRead.texture;
    // Fade rate: lower = shorter trails. Keep subtle even during storms.
    trailMat.uniforms.uFade.value = 0.75 + intensity * 0.08;
    renderer.setRenderTarget(trailWrite);
    renderer.render(trailScene, compCamera);

    // 3. Bloom on the trail-accumulated result
    bloomMat.uniforms.tDiffuse.value = trailWrite.texture;
    bloomMat.uniforms.uBloomStrength.value = 0.3 + intensity * 0.4;
    renderer.setRenderTarget(null);
    renderer.render(bloomScene, bloomCamera);

    // 4. Swap ping-pong buffers
    const tmp = trailRead; trailRead = trailWrite; trailWrite = tmp;
  };
  animate();

  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    sceneRT.setSize(w, h);
    trailRT_A.setSize(w, h);
    trailRT_B.setSize(w, h);
    bloomMat.uniforms.uResolution.value.set(w, h);
  };
  window.addEventListener("resize", onResize);

  return () => {
    cancelAnimationFrame(animId);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMM);
    renderer.dispose();
    if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
  };
}

/* ═══════════════════════════════════════════
   HUD
   ═══════════════════════════════════════════ */
function HUD({ dataRef, playerRef, onCamera, currentCam, audioOn, onToggleAudio }) {
  const els = useRef({});
  const scrubberRef = useRef(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const iv = setInterval(() => {
      const d = dataRef.current;
      if (!d) return;
      const l = d.latest;
      const s = (k, v) => { if (els.current[k]) els.current[k].textContent = v; };
      s("speed", `${Math.round(l.speed)} km/s`);
      s("density", `${l.density.toFixed(1)} p/cm³`);
      s("bt", `${l.bt.toFixed(1)} nT`);
      s("bz", `${l.bz.toFixed(1)} nT`);
      s("kp", `Kp ${l.kp.toFixed(1)}`);
      const storm = Math.min(1, (l.kp/9 + l.speed/900 + l.bt/25) / 2.5);
      s("storm", `${(storm*100).toFixed(0)}%`);
      if (els.current.bz) els.current.bz.style.color = l.bz < 0 ? "#ff6688" : "#44ffcc";

      // Timeline info
      if (d.currentTime) {
        const dt = d.currentTime;
        const date = new Date(dt.replace(" ", "T") + "Z");
        if (!isNaN(date)) {
          const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const formatted = `${days[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${String(date.getUTCHours()).padStart(2,"0")}:${String(date.getUTCMinutes()).padStart(2,"0")} UTC`;
          s("timestamp", formatted);
        }
      }
      if (d.progress !== undefined) {
        const pct = `${d.progress * 100}%`;
        if (els.current.scrubFill) els.current.scrubFill.style.width = pct;
        if (els.current.playhead) els.current.playhead.style.left = pct;
      }
      if (els.current.scrubTime && d.currentTime) {
        const dt = d.currentTime;
        const date = new Date(dt.replace(" ", "T") + "Z");
        if (!isNaN(date)) {
          const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const full = `${days[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} · ${String(date.getUTCHours()).padStart(2,"0")}:${String(date.getUTCMinutes()).padStart(2,"0")} UTC`;
          els.current.scrubTime.textContent = full;
        }
      }
      // Day markers — build once, update position
      if (els.current.dayMarkers && playerRef?.current?.timeline?.length > 0 && !els.current._dayMarkersBuilt) {
        const tl = playerRef.current.timeline;
        const firstTime = new Date(tl[0].time.replace(" ", "T") + "Z");
        const lastTime = new Date(tl[tl.length - 1].time.replace(" ", "T") + "Z");
        const totalMs = lastTime - firstTime;
        const daysLabels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const container = els.current.dayMarkers;
        container.innerHTML = "";
        // Find midnight boundaries
        const startDay = new Date(firstTime);
        startDay.setUTCHours(0, 0, 0, 0);
        startDay.setUTCDate(startDay.getUTCDate() + 1);
        for (let dt = new Date(startDay); dt < lastTime; dt.setUTCDate(dt.getUTCDate() + 1)) {
          const pct = ((dt - firstTime) / totalMs) * 100;
          if (pct > 0 && pct < 100) {
            const tick = document.createElement("div");
            tick.style.cssText = `position:absolute;left:${pct}%;top:0;transform:translateX(-50%);text-align:center;font-family:'IBM Plex Mono',monospace;`;
            tick.innerHTML = `<div style="width:1px;height:6px;background:rgba(255,255,255,0.15);margin:0 auto"></div><div style="font-size:7px;color:rgba(255,255,255,0.3);letter-spacing:1px;margin-top:1px">${daysLabels[dt.getUTCDay()]} ${dt.getUTCDate()}</div>`;
            container.appendChild(tick);
          }
        }
        els.current._dayMarkersBuilt = true;
      }
      if (els.current.source) {
        els.current.source.textContent = d.isLive ? "● LIVE NOAA DATA" : "● SIMULATED DATA";
        els.current.source.style.color = d.isLive ? "#44ffaa" : "#ff9944";
      }
    }, 300);
    return () => clearInterval(iv);
  }, [dataRef]);

  const font = "'IBM Plex Mono',monospace";
  const lbl = { fontSize: 7, color: "rgba(255,255,255,0.55)", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: font };
  const val = { fontSize: 10, fontWeight: 600, fontFamily: font };
  const btn = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20,
    padding: "5px 14px", fontSize: 8, fontFamily: font, letterSpacing: 1.5, cursor: "pointer", color: "rgba(255,255,255,0.65)", transition: "all 0.3s" };
  const btnActive = { ...btn, background: "rgba(68,255,170,0.1)", borderColor: "rgba(68,255,170,0.3)", color: "#44ffaa" };

  const keyData = [
    { section: "WHAT YOU SEE", items: [
      { color: "#44ff88", label: "Green curtain", desc: "Quiet aurora — Bz is positive (northward)" },
      { color: "#ff4466", label: "Red/magenta curtain", desc: "Storm aurora — Bz has gone negative (southward)" },
      { color: "#9944ff", label: "Purple glow", desc: "Severe storm — strong negative Bz + high Kp" },
      { color: "#5566ff", label: "Blue/purple streams", desc: "Solar wind particles flowing past" },
      { color: "#44ccaa", label: "Curved lines", desc: "Magnetic field lines — flex with Bt strength" },
      { color: "#ffffff", label: "Shooting stars", desc: "More frequent during high Kp (geomagnetic activity)" },
    ]},
    { section: "WHAT YOU HEAR", items: [
      { color: "#ff6b8a", label: "Deep drone", desc: "Pitch follows solar wind speed" },
      { color: "#44ffcc", label: "Chord mood", desc: "Major = calm (Bz+), minor/dissonant = storm (Bz−)" },
      { color: "#44ddff", label: "Plucked notes", desc: "Rate increases with plasma density" },
      { color: "#ff9944", label: "Filtered hiss", desc: "Brightness tracks magnetic field strength Bt" },
      { color: "#ff6666", label: "Bell chimes", desc: "Triggered by X-ray flux spikes (solar flares)" },
      { color: "#aa77ff", label: "Sub-bass rumble", desc: "Kicks in during high Kp geomagnetic storms" },
    ]},
  ];

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10, fontFamily: font }}>
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(10px); } }
      `}</style>

      {/* Top left — data */}
      <div style={{ position: "absolute", top: 18, left: 22, pointerEvents: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#44ffaa", boxShadow: "0 0 10px #44ffaa88" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: 4 }}>AURORA</span>
        </div>
        <div style={{ ...lbl, paddingLeft: 14, marginBottom: 10 }}>SPACE WEATHER → LIGHT & SOUND</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", paddingLeft: 14 }}>
          <div><div style={lbl}>Wind</div><div ref={el => els.current.speed = el} style={{ ...val, color: "#ff6b8a" }}>—</div></div>
          <div><div style={lbl}>Density</div><div ref={el => els.current.density = el} style={{ ...val, color: "#44ddff" }}>—</div></div>
          <div><div style={lbl}>Bt</div><div ref={el => els.current.bt = el} style={{ ...val, color: "#ff9944" }}>—</div></div>
          <div><div style={lbl}>Bz</div><div ref={el => els.current.bz = el} style={{ ...val, color: "#44ffcc" }}>—</div></div>
          <div><div style={lbl}>Kp</div><div ref={el => els.current.kp = el} style={{ ...val, color: "#aa77ff" }}>—</div></div>
          <div><div style={lbl}>Storm</div><div ref={el => els.current.storm = el} style={{ ...val, color: "#ffaa44" }}>—</div></div>
        </div>

        {/* Timeline info */}
        <div style={{ paddingLeft: 14, marginTop: 12 }}>
          <div ref={el => els.current.source = el} style={{ fontSize: 7, letterSpacing: 2, fontFamily: font, marginBottom: 2, color: "#ff9944" }}>● LOADING...</div>
          <div ref={el => els.current.timestamp = el} style={{ fontSize: 11, color: "#fff", fontFamily: font, fontWeight: 500, letterSpacing: 1 }}>—</div>
        </div>
      </div>

      {/* Top right — controls */}
      <div style={{ position: "absolute", top: 18, right: 22, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, pointerEvents: "auto" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onToggleAudio} style={audioOn ? btnActive : btn}>
            {audioOn ? "♪ SOUND ON" : "♪ SOUND OFF"}
          </button>
          <button onClick={() => setKeyOpen(k => !k)} style={keyOpen ? btnActive : btn}>
            {keyOpen ? "✕ KEY" : "? KEY"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {Object.entries(CAMERAS).map(([key, cam]) => (
            <button key={key} onClick={() => onCamera(key)} style={currentCam === key ? btnActive : btn}>
              {cam.name.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom — timeline scrubber */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, pointerEvents: "auto", padding: "0 22px 16px 22px" }}>
        {/* Day markers */}
        <div ref={el => els.current.dayMarkers = el} style={{ position: "relative", height: 16, marginBottom: 2 }} />

        {/* Scrubber track */}
        <div
          ref={scrubberRef}
          onClick={e => {
            if (!scrubberRef.current || !playerRef?.current) return;
            const rect = scrubberRef.current.getBoundingClientRect();
            const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            playerRef.current.seekTo(fraction);
            dataRef.current = playerRef.current.getCurrent(0);
          }}
          style={{
            position: "relative", width: "100%", height: 20, cursor: "pointer",
            display: "flex", alignItems: "center",
          }}
        >
          {/* Track background */}
          <div style={{
            position: "absolute", left: 0, right: 0, height: 3,
            background: "rgba(255,255,255,0.08)", borderRadius: 2,
          }} />

          {/* Filled portion */}
          <div ref={el => els.current.scrubFill = el} style={{
            position: "absolute", left: 0, height: 3, borderRadius: 2,
            background: "linear-gradient(90deg, #44ffaa, #44ddff, #aa77ff)",
            width: "0%", transition: "width 0.3s ease",
          }} />

          {/* Playhead */}
          <div ref={el => els.current.playhead = el} style={{
            position: "absolute", width: 12, height: 12, borderRadius: "50%",
            background: "#44ffaa", boxShadow: "0 0 10px #44ffaa88, 0 0 20px #44ffaa44",
            left: "0%", transform: "translateX(-50%)",
            transition: "left 0.3s ease",
          }} />
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={() => {
                if (!playerRef?.current) return;
                const isPaused = playerRef.current.togglePause();
                setPaused(isPaused);
              }}
              style={{
                ...btn, padding: "3px 12px", fontSize: 10, borderRadius: 14,
                ...(paused ? { background: "rgba(255,150,68,0.1)", borderColor: "rgba(255,150,68,0.3)", color: "#ffaa44" } : {}),
              }}
            >
              {paused ? "▶ PLAY" : "❚❚ PAUSE"}
            </button>
            <span ref={el => els.current.scrubTime = el} style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: font, letterSpacing: 1 }}>—</span>
          </div>
          <span style={{ fontSize: 7, color: "rgba(255,255,255,0.25)", fontFamily: font, letterSpacing: 1.5 }}>7-DAY TIMELINE — CLICK TO SCRUB</span>
        </div>
      </div>

      {/* Collapsible key panel */}
      {keyOpen && (
        <div style={{
          position: "absolute", top: 80, right: 22, pointerEvents: "auto",
          background: "rgba(4,4,12,0.88)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14, padding: "18px 22px", width: 320, maxHeight: "calc(100vh - 120px)",
          overflowY: "auto", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          animation: "slideIn 0.25s ease-out",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", letterSpacing: 2, textTransform: "uppercase", fontWeight: 600 }}>Experience Key</span>
            <button onClick={() => setKeyOpen(false)} style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer",
              fontSize: 14, fontFamily: font, padding: "2px 6px", lineHeight: 1,
            }}>✕</button>
          </div>

          {keyData.map(section => (
            <div key={section.section} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 8, color: "rgba(68,255,170,0.65)", letterSpacing: 2, marginBottom: 10, textTransform: "uppercase", fontWeight: 500 }}>
                {section.section}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {section.items.map(item => (
                  <div key={item.label} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", background: item.color, flexShrink: 0,
                      marginTop: 3, boxShadow: `0 0 8px ${item.color}55`,
                    }} />
                    <div>
                      <div style={{ fontSize: 10, color: item.color, fontWeight: 500, letterSpacing: 0.5, marginBottom: 1 }}>{item.label}</div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, letterSpacing: 0.2 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", letterSpacing: 1, lineHeight: 1.7 }}>
              Replaying 7 days of real NOAA SWPC data from DSCOVR and GOES satellites. Timeline refreshes automatically when it reaches the end.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   APP
   ═══════════════════════════════════════════ */
export default function AuroraApp() {
  const containerRef = useRef(null);
  const dataRef = useRef(null);
  const sonRef = useRef(null);
  const camRef = useRef("orbit");
  const cleanRef = useRef(null);
  const playerRef = useRef(null);
  const [audioOn, setAudioOn] = useState(false);
  const [started, setStarted] = useState(false);
  const [cam, setCam] = useState("orbit");

  // Initialise timeline player and start playback loop
  useEffect(() => {
    const player = new TimelinePlayer();
    playerRef.current = player;

    // Initial fetch
    player.fetchLive().then(() => {
      // Set initial data
      dataRef.current = player.getCurrent(0);
    });

    // Playback: advance through timeline, interpolate between points
    let tickCount = 0;
    const TICKS_PER_POINT = 15; // At 130ms interval = ~2s per data point

    const iv = setInterval(() => {
      if (!player || player.loading || player.timeline.length === 0) return;

      tickCount++;
      const fraction = tickCount / TICKS_PER_POINT;

      if (tickCount >= TICKS_PER_POINT) {
        tickCount = 0;
        const looped = player.advance();
        // If we've completed the full timeline, re-fetch fresh data
        if (looped) {
          player.fetchLive();
        }
      }

      // Update dataRef with interpolated current values
      dataRef.current = player.getCurrent(Math.min(fraction, 1));

      // Update sonification
      if (sonRef.current?.on) sonRef.current.update(dataRef.current);
    }, 130);

    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!started || !containerRef.current) return;
    cleanRef.current = buildScene(containerRef.current, dataRef, camRef);
    return () => { if (cleanRef.current) cleanRef.current(); };
  }, [started]);

  const toggleAudio = useCallback(async () => {
    if (!sonRef.current) sonRef.current = new SonEngine();
    if (audioOn) { sonRef.current.stop(); sonRef.current = null; setAudioOn(false); }
    else { await sonRef.current.start(); sonRef.current.update(dataRef.current); setAudioOn(true); }
  }, [audioOn]);

  const setCamera = useCallback((key) => { camRef.current = key; setCam(key); }, []);

  useEffect(() => () => { if (sonRef.current) sonRef.current.stop(); }, []);

  if (!started) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#010104", display: "flex",
        alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono',monospace", color: "#fff", position: "relative", overflow: "hidden" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&display=swap');
          @keyframes glow{0%,100%{text-shadow:0 0 30px rgba(68,255,170,0.3),0 0 60px rgba(68,255,170,0.1)}50%{text-shadow:0 0 50px rgba(68,255,170,0.6),0 0 100px rgba(68,255,170,0.2),0 0 150px rgba(68,255,170,0.1)}}
          @keyframes drift{0%{transform:translateY(0) scale(1)}50%{transform:translateY(-10px) scale(1.1)}100%{transform:translateY(0) scale(1)}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
          *{margin:0;padding:0;box-sizing:border-box}
        `}</style>

        {/* Background particles */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          {Array.from({ length: 50 }, (_, i) => (
            <div key={i} style={{
              position: "absolute", left: `${Math.random()*100}%`, top: `${Math.random()*100}%`,
              width: 2 + Math.random() * 6, height: 2 + Math.random() * 6, borderRadius: "50%",
              background: i%3===0 ? `rgba(68,255,170,${0.06+Math.random()*0.12})` : i%3===1 ? `rgba(100,68,255,${0.05+Math.random()*0.1})` : `rgba(255,68,100,${0.04+Math.random()*0.08})`,
              filter: `blur(${2+Math.random()*4}px)`,
              animation: `drift ${3+Math.random()*5}s ease-in-out infinite ${Math.random()*4}s`,
            }} />
          ))}
          <div style={{ position: "absolute", top: "20%", left: 0, right: 0, height: "35%",
            background: "linear-gradient(180deg, transparent 0%, rgba(68,255,170,0.015) 30%, rgba(68,255,170,0.03) 50%, rgba(100,68,255,0.015) 70%, transparent 100%)",
            filter: "blur(40px)" }} />
        </div>

        {/* Content */}
        <div style={{ position: "relative", zIndex: 1, maxWidth: 720, width: "100%", padding: "0 20px", textAlign: "center", overflowY: "auto", maxHeight: "100vh", paddingTop: "clamp(20px, 5vh, 60px)", paddingBottom: 40 }}>
          <div style={{ animation: "glow 4s ease-in-out infinite", fontSize: "clamp(28px, 7vw, 52px)", fontWeight: 300, letterSpacing: "clamp(6px, 2vw, 16px)", marginBottom: 4 }}>
            AURORA
          </div>
          <div style={{ fontSize: "clamp(9px, 2vw, 12px)", color: "rgba(255,255,255,0.55)", letterSpacing: "clamp(3px, 1vw, 6px)", marginBottom: "clamp(20px, 4vh, 44px)", animation: "fadeIn 1s ease-out 0.2s both" }}>
            SPACE WEATHER SONIFIED
          </div>

          {/* Description */}
          <div style={{ animation: "fadeIn 1s ease-out 0.4s both", marginBottom: "clamp(20px, 3vh, 40px)", lineHeight: 2 }}>
            <p style={{ fontSize: "clamp(12px, 3vw, 15px)", color: "rgba(255,255,255,0.6)", marginBottom: 18, letterSpacing: 0.3 }}>
              Right now, the Sun is bombarding Earth with a stream of charged particles travelling at hundreds of kilometres per second. When this solar wind hits our magnetic field, it funnels down toward the poles and ignites the atmosphere — creating the aurora.
            </p>
            <p style={{ fontSize: "clamp(12px, 3vw, 15px)", color: "rgba(255,255,255,0.55)", letterSpacing: 0.3 }}>
              This experience pulls the last 7 days of real space weather data from NOAA's deep-space satellites and replays it as light and sound. Every particle you see, every note you hear, is driven by what actually happened between the Sun and Earth over the past week. You'll see quiet periods, sudden storms, and everything in between — all from real measurements.
            </p>
          </div>

          {/* Data mapping legend */}
          <div style={{ animation: "fadeIn 1s ease-out 0.6s both", marginBottom: "clamp(20px, 3vh, 40px)" }}>
            <div style={{ fontSize: 10, color: "rgba(68,255,170,0.6)", letterSpacing: 3, marginBottom: 14, textTransform: "uppercase" }}>How the data becomes the aurora</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 36px", textAlign: "left", maxWidth: 540, margin: "0 auto" }}>
              {[
                ["Solar Wind Speed", "Aurora brightness & particle flow", "#ff6b8a"],
                ["Plasma Density", "Plucked notes — more particles, more plucks", "#44ddff"],
                ["Magnetic Bz", "Aurora colour — green when calm, red/purple when stormy", "#44ffcc"],
                ["Magnetic Bt", "Field line distortion & filtered noise hiss", "#ff9944"],
                ["Kp Index", "Sub-bass rumble & shooting star frequency", "#aa77ff"],
                ["X-Ray Flux", "High bell chimes on solar flare spikes", "#ff6666"],
              ].map(([label, desc, color]) => (
                <div key={label} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 5, boxShadow: `0 0 8px ${color}66` }} />
                  <div>
                    <div style={{ fontSize: 11, color: color, letterSpacing: 1, fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 0.3, lineHeight: 1.6 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setStarted(true)} style={{
            background: "rgba(68,255,170,0.06)", border: "1px solid rgba(68,255,170,0.2)",
            color: "#44ffaa", padding: "16px 56px", borderRadius: 60, cursor: "pointer",
            fontSize: 11, letterSpacing: 6, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 400,
            transition: "all 0.4s", animation: "fadeIn 1s ease-out 0.8s both",
          }}
            onMouseEnter={e => { e.target.style.background = "rgba(68,255,170,0.12)"; e.target.style.boxShadow = "0 0 40px rgba(68,255,170,0.15), 0 0 80px rgba(68,255,170,0.05)"; e.target.style.borderColor = "rgba(68,255,170,0.4)"; }}
            onMouseLeave={e => { e.target.style.background = "rgba(68,255,170,0.06)"; e.target.style.boxShadow = "none"; e.target.style.borderColor = "rgba(68,255,170,0.2)"; }}
          >ENTER</button>

          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 24, letterSpacing: 2, animation: "fadeIn 1s ease-out 1s both" }}>
            ENABLE SOUND FOR THE FULL EXPERIENCE · MOVE MOUSE TO LOOK AROUND
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#010104", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
      `}</style>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <HUD dataRef={dataRef} playerRef={playerRef} onCamera={setCamera} currentCam={cam} audioOn={audioOn} onToggleAudio={toggleAudio} />
    </div>
  );
}
