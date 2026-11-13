/* ============================================================
   Pedus Apex — game.js (v2: gráficos avanzados + clima + GLB)
   Juego de carreras 3D arcade con Three.js r160 (ES6+).

   Novedades de esta versión:
     - Sombras dinámicas que siguen al coche (máxima nitidez cerca
       de la acción) + normalBias anti-acné.
     - Texturas procedurales "hiperrealistas": asfalto con mapa de
       rugosidad y bump (grietas, huellas), hierba detallada, pintura
       de coche con clearcoat + entorno PMREM para reflejos reales.
     - Postprocesado con Bloom (luces y faros brillan de verdad).
     - Eventos meteorológicos: despejado, atardecer, lluvia, niebla
       y tormenta con rayos. El asfalto se moja (más reflejo, menos
       adherencia), salen charcos, faros y lluvia de partículas.
     - Soporte de 5 modelos GLB propios (ver GLB_MODELS y README.md):
       si el archivo existe se usa; si no, se mantiene el procedural.

   Arquitectura modular (clases):
     InputManager · AudioManager · Track · Car · AIController ·
     WeatherManager · HUD · Game
   ============================================================ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ============================================================
   CONFIGURACIÓN DE MODELOS 3D (tus 5 modelos: .glb o .obj)
   ------------------------------------------------------------
   Coloca tus archivos en la carpeta  models/  del repo.
   Se aceptan AMBOS formatos: .glb (recomendado) y .obj.
   El cargador prueba automáticamente la otra extensión si
   la primera no existe, así que puedes subir p. ej.
   player-car.obj aunque aquí ponga .glb (y viceversa):
     1. models/player-car.glb/.obj   → tu coche del jugador
     2. models/rival-car.glb/.obj    → coche de los rivales IA
     3. models/tree.glb/.obj         → árbol decorativo
     4. models/grandstand.glb/.obj   → grada / tribuna
     5. models/mountain.glb/.obj     → montaña lejana
   NOTA OBJ: para colores/texturas, sube también el .mtl
   con el mismo nombre (player-car.mtl) y las texturas que
   referencie. Sin .mtl, el OBJ se ve en gris neutro.
   Si un archivo no existe, el juego usa el modelo procedural
   automáticamente (nunca se rompe). Ver README.md.
   También puedes poner una URL completa de GitHub, p. ej.:
     'https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/models/player-car.glb'
   ============================================================ */
const GLB_MODELS = {
  playerCar: 'models/player-car.glb',
  rivalCar: 'models/rival-car.glb',
  tree: 'models/tree.glb',
  grandstand: 'models/grandstand.glb',
  mountain: 'models/mountain.glb',
};
const USE_GLB_MODELS = true;   // pon false para forzar siempre los modelos procedurales
const GLB_CAR_YAW = 0;         // rotación Y de los coches GLB. Si tu modelo mira al revés, pon Math.PI

/* ---------------- Utilidades ---------------- */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Formatea milisegundos a mm:ss.mmm */
function formatTime(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

/** Diferencia paramétrica envuelta en [-0.5, 0.5] (progreso en curva cerrada) */
function wrapDelta(d) {
  if (d < -0.5) d += 1;
  if (d > 0.5) d -= 1;
  return d;
}

/** Crea un canvas y devuelve su contexto 2D */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

/* ============================================================
   Generadores de texturas procedurales "hiperrealistas"
   (sin archivos externos: ruido, grietas, huellas, hierba…)
   ============================================================ */
function generateAsphaltTextures(anisotropy = 4) {
  const S = 512;
  const [cMap, g] = makeCanvas(S, S);
  const [cRough, gr] = makeCanvas(S, S);
  const [cBump, gb] = makeCanvas(S, S);

  // Base asfáltica oscura con variación de tono
  g.fillStyle = '#34383e'; g.fillRect(0, 0, S, S);
  gr.fillStyle = '#d8d8d8'; gr.fillRect(0, 0, S, S);   // rugoso por defecto
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, S, S);

  // Manchas grandes de desgaste / parches
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 30 + Math.random() * 90;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    grad.addColorStop(0, dark ? 'rgba(18,20,24,0.20)' : 'rgba(120,128,138,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Grano fino de árido (miles de puntos)
  for (let i = 0; i < 14000; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? `rgba(210,215,222,${Math.random() * 0.16})` : `rgba(8,9,11,${Math.random() * 0.22})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    const rv = 150 + Math.random() * 105;
    gr.fillStyle = `rgb(${rv},${rv},${rv})`;
    gr.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // Huellas de neumáticos: dos bandas oscuras a lo largo de U
  for (const bandX of [S * 0.30, S * 0.70]) {
    for (let i = 0; i < 2600; i++) {
      const x = bandX + (Math.random() - 0.5) * 34;
      const y = Math.random() * S;
      g.fillStyle = `rgba(10,11,13,${0.10 + Math.random() * 0.16})`;
      g.fillRect(x, y, 5, 3);
      gr.fillStyle = 'rgba(90,90,90,0.5)'; gr.fillRect(x, y, 5, 3); // goma = menos rugoso
    }
  }
  // Grietas finas
  g.strokeStyle = 'rgba(12,13,15,0.55)'; g.lineWidth = 1;
  gb.strokeStyle = 'rgba(40,40,40,0.8)';
  for (let i = 0; i < 14; i++) {
    let x = Math.random() * S, y = Math.random() * S;
    g.beginPath(); gb.beginPath(); g.moveTo(x, y); gb.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (Math.random() - 0.5) * 46; y += (Math.random() - 0.5) * 46;
      g.lineTo(x, y); gb.lineTo(x, y);
    }
    g.stroke(); gb.stroke();
  }
  // Líneas de desgaste en los bordes
  const edge = g.createLinearGradient(0, 0, S, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.28)'); edge.addColorStop(0.08, 'rgba(0,0,0,0)');
  edge.addColorStop(0.92, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = edge; g.fillRect(0, 0, S, S);

  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(140, 1);
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(cMap, true), roughnessMap: mk(cRough, false), bumpMap: mk(cBump, false) };
}

function generateGrassTexture(anisotropy = 4) {
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#4c8f43'; g.fillRect(0, 0, S, S);
  // Parches de color (hierba seca / tierra)
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 70;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, Math.random() > 0.4 ? 'rgba(122,140,62,0.25)' : 'rgba(96,74,44,0.20)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Briznas de hierba
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const shade = Math.random();
    g.strokeStyle = shade > 0.6 ? 'rgba(140,200,110,0.5)' : 'rgba(40,90,36,0.5)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 4, y - 3 - Math.random() * 5); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(90, 90);
  t.anisotropy = anisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ============================================================
   InputManager — teclado (flechas/WASD). Sin controles táctiles.
   ============================================================ */
class InputManager {
  constructor() {
    this.keys = new Set();
    this.onAction = null; // callback(tecla) para R, C, P, M, T…

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        if (this.onAction) this.onAction(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Estado unificado { throttle, brake, steer, handbrake } */
  getInput() {
    const k = this.keys;
    return {
      throttle: (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0,
      brake: (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0,
      steer: ((k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0)
           - ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0),
      handbrake: k.has('Space'),
    };
  }
}

/* ============================================================
   AudioManager — sonido sintetizado con Web Audio API:
   motor, derrape, lluvia y truenos (sin archivos externos).
   ============================================================ */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // --- Motor: dos osciladores + filtro paso bajo ---
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420; filter.Q.value = 2;
    this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineOsc = this.ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
    this.engineOsc2 = this.ctx.createOscillator(); this.engineOsc2.type = 'square'; this.engineOsc2.frequency.value = 28;
    this.engineOsc.connect(filter); this.engineOsc2.connect(filter);
    filter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start(); this.engineOsc2.start();

    // Ruido reutilizable (derrape + lluvia)
    const len = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buffer;

    const skid = this.ctx.createBufferSource(); skid.buffer = buffer; skid.loop = true;
    const band = this.ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 1.2;
    this.skidGain = this.ctx.createGain(); this.skidGain.gain.value = 0;
    skid.connect(band); band.connect(this.skidGain); this.skidGain.connect(this.master);
    skid.start();

    const rain = this.ctx.createBufferSource(); rain.buffer = buffer; rain.loop = true;
    const rainFilter = this.ctx.createBiquadFilter(); rainFilter.type = 'lowpass'; rainFilter.frequency.value = 1400;
    this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
    rain.connect(rainFilter); rainFilter.connect(this.rainGain); this.rainGain.connect(this.master);
    rain.start();
  }

  update(speedRatio, drifting, throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const freq = 55 + speedRatio * 230 + (throttle ? 14 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(freq * 0.5, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.04 + speedRatio * 0.09, t, 0.08);
    this.skidGain.gain.setTargetAtTime(drifting ? 0.14 : 0, t, 0.05);
  }

  /** Nivel de lluvia 0..1 (0 = silencio) */
  setRainLevel(v) {
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(v * 0.10, this.ctx.currentTime, 0.4);
  }

  /** Trueno: estallido de ruido grave con caída larga */
  thunder() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuffer;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 2);
  }

  beep(freq = 440, duration = 0.15, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + duration);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}

/* ============================================================
   Track — circuito cerrado (CatmullRom), asfalto hiperrealista,
   pianos, meta con arco, charcos y escenario low-poly.
   Guarda las transformaciones del escenario para poder
   sustituirlo por tus modelos GLB cuando se carguen.
   ============================================================ */
class Track {
  constructor(scene, anisotropy = 4) {
    this.scene = scene;
    this.halfWidth = 7;
    this.samples = [];
    this.length = 0;

    const pts = [
      [0, -125], [85, -115], [145, -75], [155, -10], [115, 40], [135, 105],
      [70, 145], [0, 125], [-65, 145], [-125, 105], [-145, 30], [-115, -30],
      [-135, -95], [-70, -125],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength();
    this.samples = this.curve.getSpacedPoints(1000);

    this._treeTransforms = [];
    this._mountainTransforms = [];
    this._standTransforms = [];

    this._buildLights();
    this._buildSky();
    this._buildGround(anisotropy);
    this._buildRoad(anisotropy);
    this._buildKerbs();
    this._buildCenterLine();
    this._buildStartLine();
    this._buildPuddles();
    this._buildScenery();
  }

  /* ---------- Luces (sol con sombras que siguen al coche) ---------- */
  _buildLights() {
    const sun = new THREE.DirectionalLight(0xfff2d9, 2.6);
    sun.position.set(140, 200, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Cámara de sombra ajustada: al seguir al coche, la resolución
    // efectiva cerca de la acción se multiplica por ~4.
    sun.shadow.camera.left = -130; sun.shadow.camera.right = 130;
    sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.6; // evita el acné en el asfalto texturizado
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(140, 200, 90); // dirección del sol (la mueve el clima)

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3d6b35, 0.9);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.Fog(0xcfe8ff, 140, 680);
  }

  /** Mantiene la sombra nítida siguiendo al coche del jugador */
  updateShadowFollow(focusPos) {
    this.sun.position.copy(focusPos).add(this.sunOffset);
    this.sun.target.position.copy(focusPos);
    this.sun.target.updateMatrixWorld();
  }

  /* ---------- Cielo con degradado + resplandor del sol ---------- */
  _buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f6fd0) },
        mid: { value: new THREE.Color(0x8ec9f2) },
        bot: { value: new THREE.Color(0xeaf6ff) },
        sunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
        sunColor: { value: new THREE.Color(0xfff2d9) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunColor;
        void main(){
          vec3 d = normalize(vP);
          float h = d.y;
          vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(bot, mid, smoothstep(-0.08, 0.12, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 350.0) * 1.2 + pow(s, 8.0) * 0.18); // disco + halo del sol
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, this.skyMaterial));
  }

  _buildGround(anisotropy) {
    this.groundMaterial = new THREE.MeshStandardMaterial({
      map: generateGrassTexture(anisotropy), roughness: 1, metalness: 0,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /* ---------- Asfalto hiperrealista (color + rugosidad + bump) ---------- */
  _ribbonGeometry(width, y, uvScale = 1) {
    const SEG = 600;
    const pos = [], uv = [], idx = [];
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      const nx = -t.z, nz = t.x;
      pos.push(p.x + nx * width / 2, y, p.z + nz * width / 2);
      pos.push(p.x - nx * width / 2, y, p.z - nz * width / 2);
      uv.push(u * uvScale, 0, u * uvScale, 1);
      if (i < SEG) {
        const a = i * 2, b = a + 1, c2 = a + 2, d = a + 3;
        idx.push(a, b, c2, b, d, c2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  _buildRoad(anisotropy) {
    const tex = generateAsphaltTextures(anisotropy);
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      bumpMap: tex.bumpMap,
      bumpScale: 0.6,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.35,
    });
    const road = new THREE.Mesh(this._ribbonGeometry(this.halfWidth * 2, 0.05, 1), this.roadMaterial);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  /* ---------- Pianos rojos/blancos ---------- */
  _buildKerbs() {
    const SEG = 600, W = 1.5, OFF = this.halfWidth + W / 2 - 0.2;
    const red = new THREE.Color(0xd7263d), white = new THREE.Color(0xf5f5f5);
    for (const side of [1, -1]) {
      const pos = [], col = [], idx = [];
      const p = new THREE.Vector3(), t = new THREE.Vector3();
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG;
        this.curve.getPointAt(u, p);
        this.curve.getTangentAt(u, t);
        const nx = -t.z * side, nz = t.x * side;
        const cx = p.x + nx * OFF, cz = p.z + nz * OFF;
        pos.push(cx + nx * W / 2, 0.06, cz + nz * W / 2);
        pos.push(cx - nx * W / 2, 0.06, cz - nz * W / 2);
        const c = (Math.floor(i / 8) % 2 === 0) ? red : white;
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const kerb = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
      kerb.receiveShadow = true;
      this.scene.add(kerb);
    }
  }

  /* ---------- Línea central discontinua ---------- */
  _buildCenterLine() {
    const pos = [], idx = [];
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    let v = 0;
    for (let i = 0; i < 600; i += 14) {
      for (let j = 0; j < 7; j++) {
        const u = (i + j) / 600;
        this.curve.getPointAt(u, p);
        this.curve.getTangentAt(u, t);
        const nx = -t.z, nz = t.x;
        pos.push(p.x + nx * 0.18, 0.08, p.z + nz * 0.18);
        pos.push(p.x - nx * 0.18, 0.08, p.z - nz * 0.18);
        if (j > 0) { const a = v - 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        v += 2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf8f8f0, roughness: 0.8 })));
  }

  /* ---------- Meta a cuadros + arco ---------- */
  _buildStartLine() {
    const [c, g] = makeCanvas(256, 64);
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const p = this.curve.getPointAt(0), t = this.curve.getTangentAt(0);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfWidth * 2, 3),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(t.x, t.z);
    line.position.set(p.x, 0.09, p.z);
    this.scene.add(line);

    const arch = new THREE.Group();
    const nx = -t.z, nz = t.x;
    const pilGeo = new THREE.BoxGeometry(1.2, 7, 1.2);
    const pilMat = new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.6 });
    for (const s of [1, -1]) {
      const pil = new THREE.Mesh(pilGeo, pilMat);
      pil.position.set(p.x + nx * s * (this.halfWidth + 1), 3.5, p.z + nz * s * (this.halfWidth + 1));
      pil.castShadow = true; arch.add(pil);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(this.halfWidth * 2 + 3.4, 1.4, 1),
      new THREE.MeshStandardMaterial({ color: 0xff2d55, roughness: 0.5 })
    );
    beam.position.set(p.x, 7.2, p.z);
    beam.rotation.y = Math.atan2(t.x, t.z);
    beam.castShadow = true; arch.add(beam);
    this.scene.add(arch);
  }

  /* ---------- Charcos (visibles cuando llueve) ---------- */
  _buildPuddles() {
    this.puddleMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a3d52, transparent: true, opacity: 0,
      roughness: 0.05, metalness: 0.15, envMapIntensity: 1.6,
    });
    const geo = new THREE.CircleGeometry(1, 20);
    for (let i = 0; i < 16; i++) {
      const u = Math.random();
      const pos = this.positionAt(u, (Math.random() - 0.5) * 8);
      const puddle = new THREE.Mesh(geo, this.puddleMaterial);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(pos.x, 0.07, pos.z);
      puddle.scale.set(1.5 + Math.random() * 2.5, 1 + Math.random() * 1.5, 1);
      puddle.receiveShadow = true;
      this.scene.add(puddle);
    }
  }

  /* ---------- Escenario procedural (sustituible por GLB) ---------- */
  _isNearTrack(x, z, minDist) {
    for (let i = 0; i < this.samples.length; i += 16) {
      const s = this.samples[i];
      const dx = s.x - x, dz = s.z - z;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
  }

  _buildScenery() {
    const dummy = new THREE.Object3D();
    // Árboles instanciados
    const COUNT = 260;
    this.treeMeshes = [];
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x7a4a21, roughness: 1 }), COUNT);
    const crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.2, 5.5, 7),
      new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 1 }), COUNT);
    let placed = 0, guard = 0;
    while (placed < COUNT && guard++ < 4000) {
      const x = (Math.random() - 0.5) * 640, z = (Math.random() - 0.5) * 640;
      if (this._isNearTrack(x, z, 17)) continue;
      const s = 0.8 + Math.random() * 0.9;
      const rot = Math.random() * Math.PI * 2;
      this._treeTransforms.push({ x, z, s, rot });
      dummy.position.set(x, 1.2 * s, z); dummy.scale.setScalar(s);
      dummy.rotation.y = rot; dummy.updateMatrix();
      trunk.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = (2.4 + 2.2) * s; dummy.updateMatrix();
      crown.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    trunk.count = crown.count = placed;
    trunk.castShadow = crown.castShadow = true;
    this.scene.add(trunk, crown);
    this.treeMeshes.push(trunk, crown);

    // Rocas instanciadas
    const ROCKS = 70;
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x8d99ae, roughness: 1, flatShading: true }), ROCKS);
    placed = 0; guard = 0;
    while (placed < ROCKS && guard++ < 2000) {
      const x = (Math.random() - 0.5) * 600, z = (Math.random() - 0.5) * 600;
      if (this._isNearTrack(x, z, 13)) continue;
      dummy.position.set(x, 0.4, z);
      dummy.scale.set(0.6 + Math.random() * 1.6, 0.5 + Math.random(), 0.6 + Math.random() * 1.6);
      dummy.rotation.set(Math.random(), Math.random() * 3, Math.random());
      dummy.updateMatrix(); rocks.setMatrixAt(placed++, dummy.matrix);
    }
    rocks.count = placed; rocks.castShadow = true;
    this.scene.add(rocks);

    // Montañas lejanas
    this.mountainGroup = new THREE.Group();
    const mountMat = new THREE.MeshStandardMaterial({ color: 0x5b7fa6, roughness: 1, flatShading: true });
    const mountMat2 = new THREE.MeshStandardMaterial({ color: 0x4a6b8a, roughness: 1, flatShading: true });
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.2;
      const r = 460 + Math.random() * 160;
      const h = 70 + Math.random() * 110;
      const w = 70 + Math.random() * 70;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      this._mountainTransforms.push({ x, z, h, w });
      const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5), i % 2 ? mountMat : mountMat2);
      m.position.set(x, h / 2 - 4, z);
      this.mountainGroup.add(m);
    }
    this.scene.add(this.mountainGroup);

    // Gradas junto a la salida
    this.standGroup = new THREE.Group();
    const p = this.curve.getPointAt(0), t = this.curve.getTangentAt(0);
    const nx = -t.z, nz = t.x;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      const stand = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(16, 2, 7),
        new THREE.MeshStandardMaterial({ color: 0xdee2e6, roughness: 0.9 }));
      base.position.y = 1; base.castShadow = true; stand.add(base);
      const seatColors = [0xff2d55, 0xffd60a, 0x00e5ff];
      for (let r = 0; r < 3; r++) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(15, 0.8, 1.6),
          new THREE.MeshStandardMaterial({ color: seatColors[r], roughness: 0.8 }));
        seat.position.set(0, 2.4 + r * 1.1, -2 + r * 1.4);
        stand.add(seat);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.4, 9),
        new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.6 }));
      roof.position.set(0, 6.4, 0); roof.castShadow = true; stand.add(roof);
      const sx = p.x + nx * side * 26, sz = p.z + nz * side * 26;
      const rotY = Math.atan2(t.x, t.z) + Math.PI / 2 + (side > 0 ? 0 : Math.PI);
      this._standTransforms.push({ x: sx, z: sz, rotY });
      stand.position.set(sx, 0, sz);
      stand.rotation.y = rotY;
      this.standGroup.add(stand);
    }
    this.scene.add(this.standGroup);
  }

  /* ---------- Sustitución por modelos GLB (cuando se cargan) ---------- */
  replaceTrees(geometry, material) {
    const dummy = new THREE.Object3D();
    const inst = new THREE.InstancedMesh(geometry, material, this._treeTransforms.length);
    this._treeTransforms.forEach((tr, i) => {
      dummy.position.set(tr.x, 0, tr.z);
      dummy.scale.setScalar(tr.s * 2.2); // el GLB se normaliza a ~5 unidades de alto
      dummy.rotation.set(0, tr.rot, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.castShadow = true;
    this.scene.add(inst);
    this.treeMeshes.forEach((m) => { this.scene.remove(m); m.dispose(); });
    this.treeMeshes = [inst];
  }

  replaceMountains(geometry, material) {
    const bbox = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const h = bbox.max.y - bbox.min.y || 1;
    for (const tr of this._mountainTransforms) {
      const m = new THREE.Mesh(geometry, material);
      const s = tr.h / h;
      m.scale.set(s, s, s);
      m.position.set(tr.x, -4, tr.z);
      m.rotation.y = Math.random() * Math.PI * 2;
      this.mountainGroup.add(m);
    }
    // Ocultar los conos procedurales
    this.mountainGroup.children.forEach((m, i) => { if (i < this._mountainTransforms.length) m.visible = false; });
  }

  replaceGrandstands(modelScene) {
    // Escala objetivo: ~18 unidades de ancho; centrado en XZ y base en el suelo
    const bbox = new THREE.Box3().setFromObject(modelScene);
    const size = new THREE.Vector3(); bbox.getSize(size);
    const s = 18 / Math.max(size.x, size.z, 1);
    const center = bbox.getCenter(new THREE.Vector3());
    for (const tr of this._standTransforms) {
      const holder = new THREE.Group();
      const clone = modelScene.clone(true);
      clone.scale.setScalar(s);
      clone.position.set(-center.x * s, -bbox.min.y * s, -center.z * s);
      clone.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      holder.add(clone);
      holder.position.set(tr.x, 0, tr.z);
      holder.rotation.y = tr.rotY;
      this.scene.add(holder);
    }
    this.standGroup.visible = false;
  }

  /* ---------- Consultas sobre la curva ---------- */
  pointAt(u, target = new THREE.Vector3()) { return this.curve.getPointAt(((u % 1) + 1) % 1, target); }
  tangentAt(u, target = new THREE.Vector3()) { return this.curve.getTangentAt(((u % 1) + 1) % 1, target); }
  normalAt(u, target = new THREE.Vector3()) {
    const t = this.tangentAt(u);
    return target.set(-t.z, 0, t.x).normalize();
  }
  positionAt(u, lateral, target = new THREE.Vector3()) {
    this.pointAt(u, target);
    const n = this.normalAt(u);
    target.addScaledVector(n, lateral);
    return target;
  }
  findNearest(pos, hint = 0) {
    const N = this.samples.length;
    let best = hint, bestD = Infinity;
    for (let k = -70; k <= 70; k++) {
      const i = ((hint + k) % N + N) % N;
      const s = this.samples[i];
      const dx = s.x - pos.x, dz = s.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { index: best, u: best / N, distance: Math.sqrt(bestD) };
  }
}

/* ============================================================
   Car — coche con primitivas + física arcade + faros reales.
   Pintura con clearcoat (reflejos de entorno) y soporte GLB.
   ============================================================ */
class Car {
  constructor(scene, color, name = 'Coche') {
    this.name = name;
    this.heading = 0;
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.steer = 0;
    this.drifting = false;
    this.offTrack = false;
    this.maxSpeed = 58;
    this.maxReverse = -14;
    this.wheelSpin = 0;
    this.glbModel = null;

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this._buildMesh(color);
    scene.add(this.group);
  }

  _buildMesh(color) {
    // Pintura física con capa transparente (clearcoat) = reflejo de coche real
    const paint = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.32, metalness: 0.15,
      clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.3,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.7 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x101820, roughness: 0.08, metalness: 0.4, clearcoat: 1, envMapIntensity: 1.6 });

    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 3.7), paint);
    bodyMesh.position.y = 0.62; bodyMesh.castShadow = true; this.body.add(bodyMesh);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.7), paint);
    nose.position.set(0, 0.5, 2.0); nose.castShadow = true; this.body.add(nose);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.7), glass);
    cabin.position.set(0, 1.08, -0.25); cabin.castShadow = true; this.body.add(cabin);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.55), dark);
    wing.position.set(0, 1.12, -1.85); wing.castShadow = true; this.body.add(wing);
    for (const s of [1, -1]) {
      const sup = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.3), dark);
      sup.position.set(s * 0.7, 0.9, -1.85); this.body.add(sup);
    }
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xffe98a, emissiveIntensity: 0.7 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0xff2233, emissive: 0xff1122, emissiveIntensity: 0.8 });
    for (const s of [1, -1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.08), this.headMat);
      h.position.set(s * 0.6, 0.62, 2.36); this.body.add(h);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.08), this.tailMat);
      tl.position.set(s * 0.6, 0.68, -1.86); this.body.add(tl);
    }

    // Faro real (SpotLight) — se enciende con lluvia/niebla/atardecer
    this.headlight = new THREE.SpotLight(0xfff2c0, 0, 90, 0.55, 0.5, 1.2);
    this.headlight.position.set(0, 0.85, 2.1);
    this.headlight.target.position.set(0, 0, 18);
    this.group.add(this.headlight, this.headlight.target);

    this.wheels = [];
    this.frontPivots = [];
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 14);
    const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.34, 8);
    const positions = [[-0.95, 1.2], [0.95, 1.2], [-0.95, -1.2], [0.95, -1.2]];
    positions.forEach(([x, z], i) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.36, z);
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, dark); tire.rotation.z = Math.PI / 2; tire.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.4 }));
      hub.rotation.z = Math.PI / 2;
      wheel.add(tire, hub);
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheels.push(wheel);
      if (i < 2) this.frontPivots.push(pivot);
    });
  }

  setHeadlights(on) {
    this.headlight.intensity = on ? 220 : 0;
    this.headMat.emissiveIntensity = on ? 3.2 : 0.7; // brilla con Bloom
    this.tailMat.emissiveIntensity = on ? 2.4 : 0.8;
  }

  /* ---------- Carga de modelo propio (.glb o .obj) ---------- */
  async loadGLB(url, loader) {
    try {
      if (/\.obj$/i.test(url)) {
        const obj = await new OBJLoader().loadAsync(url);
        this.applyGLBModel(obj);
        return true;
      }
      const gltf = await loader.loadAsync(url);
      this.applyGLBModel(gltf.scene);
      return true;
    } catch (err) {
      console.info(`[Modelo] No se pudo cargar ${url} (se usa el modelo procedural).`, err.message);
      return false;
    }
  }

  applyGLBModel(model) {
    // Normalizar escala: longitud objetivo ~3.7 unidades, base en el suelo
    const bbox = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); bbox.getSize(size);
    const scale = 3.7 / Math.max(size.x, size.z, 0.001);
    model.scale.setScalar(scale);
    const b2 = new THREE.Box3().setFromObject(model);
    model.position.y -= b2.min.y;
    model.rotation.y = GLB_CAR_YAW;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Ocultar el modelo procedural y añadir el GLB
    this.body.visible = false;
    this.frontPivots.forEach((p) => { p.visible = false; });
    this.wheels.forEach((w) => { w.visible = false; });
    this.group.add(model);
    this.glbModel = model;
  }

  placeAt(pos, heading) {
    this.group.position.copy(pos);
    this.heading = heading;
    this.velocity.set(0, 0, 0);
    this.speed = 0; this.steer = 0;
    this.group.rotation.y = heading;
  }

  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get right() { const f = this.forward; return new THREE.Vector3(-f.z, 0, f.x); }

  /**
   * Física arcade con delta time.
   * @param {number} gripFactor adherencia según clima (1 = seco, <1 = mojado)
   */
  update(dt, input, onTrack, gripFactor = 1) {
    this.offTrack = !onTrack;
    const maxFwd = onTrack ? this.maxSpeed : this.maxSpeed * 0.4;
    const accel = 30, brakeDecel = 48;
    const drag = onTrack ? 0.35 : 1.5;

    let fwd = this.forward, rgt = this.right;
    let vf = this.velocity.dot(fwd);
    let vr = this.velocity.dot(rgt);

    this.steer += (input.steer - this.steer) * Math.min(1, dt * 9);
    const speedAbs = Math.abs(vf);
    const speedFactor = Math.min(speedAbs / 10, 1) * Math.sign(vf || 1);
    const turnBoost = input.handbrake ? 1.5 : 1;
    this.heading -= this.steer * 2.5 * speedFactor * turnBoost * dt;

    fwd = this.forward; rgt = this.right;

    if (input.throttle) vf += accel * dt;
    if (input.brake) {
      if (vf > 0.5) vf -= brakeDecel * dt;
      else vf -= accel * 0.55 * dt;
    }
    if (!input.throttle && !input.brake) {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
    }
    vf -= vf * drag * dt;
    if (input.handbrake) vf -= vf * 0.9 * dt;
    vf = clamp(vf, this.maxReverse, maxFwd);

    // Adherencia lateral según clima: con lluvia se derrapa más
    const grip = (input.handbrake ? 1.4 : 9) * gripFactor;
    vr *= Math.exp(-grip * dt);

    this.velocity.copy(fwd).multiplyScalar(vf).addScaledVector(rgt, vr);
    this.group.position.addScaledVector(this.velocity, dt);
    this.group.rotation.y = this.heading;

    this.speed = vf;
    this.drifting = Math.abs(vr) > 3.5 && speedAbs > 6;

    this.wheelSpin += (vf / 0.36) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = -this.steer * 0.42;
    const ratio = clamp(Math.abs(vf) / this.maxSpeed, 0, 1);
    this.body.rotation.z = this.steer * ratio * 0.09;
    this.body.rotation.x = (input.throttle ? -0.02 : 0) + (input.brake && vf > 1 ? 0.03 : 0);
  }

  speedKmh() { return Math.abs(this.speed) * 3.6; }
}

/* ============================================================
   AIController — rival que sigue la curva con velocidad
   variable y desplazamiento lateral propio.
   ============================================================ */
class AIController {
  constructor(car, track, baseSpeed, colorCss) {
    this.car = car;
    this.track = track;
    this.baseSpeed = baseSpeed;
    this.colorCss = colorCss;
    this.u = 0;
    this.lateral = 0;
    this.targetLateral = 0;
    this.lateralTimer = 0;
    this.completedLaps = 0;
    this.progress = 0;
    this.speed = 0;
    this.time = Math.random() * 10;
  }

  placeAt(u, lateral) {
    this.u = u; this.lateral = lateral; this.targetLateral = lateral;
    this.completedLaps = 0; this.progress = u; this.speed = 0;
    const pos = this.track.positionAt(u, lateral);
    const t = this.track.tangentAt(u);
    this.car.placeAt(pos, Math.atan2(t.x, t.z));
  }

  update(dt, playerProgress, gripFactor = 1) {
    this.time += dt;
    let target = this.baseSpeed * (0.88 + 0.22 * Math.sin(this.time * 0.45 + this.baseSpeed));
    const diff = playerProgress - this.progress;
    target *= clamp(1 + diff * 0.12, 0.9, 1.12);
    target *= (0.9 + 0.1 * gripFactor); // con lluvia los rivales también van un poco más lentos
    this.speed += (target - this.speed) * Math.min(1, dt * 1.5);

    this.lateralTimer -= dt;
    if (this.lateralTimer <= 0) {
      this.targetLateral = (Math.random() * 2 - 1) * 4.2;
      this.lateralTimer = 2.5 + Math.random() * 3.5;
    }
    this.lateral += (this.targetLateral - this.lateral) * Math.min(1, dt * 1.2);

    const prevU = this.u;
    this.u = (this.u + (this.speed * dt) / this.track.length) % 1;
    const d = wrapDelta(this.u - prevU);
    if (this.u < prevU) this.completedLaps++;
    this.progress += d;

    const pos = this.track.positionAt(this.u, this.lateral);
    const t = this.track.tangentAt(this.u);
    this.car.group.position.copy(pos);
    this.car.heading = Math.atan2(t.x, t.z);
    this.car.group.rotation.y = this.car.heading;
    this.car.speed = this.speed;
    this.car.wheelSpin += (this.speed / 0.36) * dt;
    for (const w of this.car.wheels) w.rotation.x = this.car.wheelSpin;
    this.car.body.rotation.z = Math.sin(this.time * 0.5) * 0.02;
  }
}

/* ============================================================
   WeatherManager — eventos meteorológicos con transiciones
   suaves: despejado, atardecer, lluvia, niebla y tormenta.
   Controla cielo, sol, niebla, lluvia de partículas, nubes,
   asfalto mojado, charcos, faros, rayos y adherencia.
   ============================================================ */
const WEATHER_ORDER = ['clear', 'sunset', 'rain', 'fog', 'storm'];
const WEATHER_PRESETS = {
  clear: {
    name: 'Despejado', icon: '☀️',
    skyTop: 0x2f6fd0, skyMid: 0x8ec9f2, skyBot: 0xeaf6ff, sunColor: 0xfff2d9,
    fogColor: 0xcfe8ff, fogNear: 140, fogFar: 680,
    sunIntensity: 2.6, hemiIntensity: 0.9, exposure: 1.05,
    sunOffset: [140, 200, 90], rain: 0, roadRough: 0.95, roadEnv: 0.35,
    grip: 1.0, headlights: false, cloudColor: 0xffffff, cloudOpacity: 0.85, puddles: 0,
  },
  sunset: {
    name: 'Atardecer', icon: '🌇',
    skyTop: 0x3a4a8a, skyMid: 0xff9a5c, skyBot: 0xffd9a0, sunColor: 0xff9a3c,
    fogColor: 0xf2b98a, fogNear: 120, fogFar: 600,
    sunIntensity: 2.0, hemiIntensity: 0.55, exposure: 1.12,
    sunOffset: [-190, 42, 70], rain: 0, roadRough: 0.9, roadEnv: 0.5,
    grip: 1.0, headlights: true, cloudColor: 0xffb37a, cloudOpacity: 0.8, puddles: 0,
  },
  rain: {
    name: 'Lluvia', icon: '🌧️',
    skyTop: 0x4a5a6a, skyMid: 0x7a8a9a, skyBot: 0xaab8c4, sunColor: 0xdfe8f0,
    fogColor: 0x9fb0c0, fogNear: 60, fogFar: 380,
    sunIntensity: 0.7, hemiIntensity: 0.65, exposure: 0.98,
    sunOffset: [80, 160, 40], rain: 1.0, roadRough: 0.22, roadEnv: 1.4,
    grip: 0.82, headlights: true, cloudColor: 0x8a9aaa, cloudOpacity: 0.95, puddles: 0.55,
  },
  fog: {
    name: 'Niebla', icon: '🌫️',
    skyTop: 0x8a9aa8, skyMid: 0xaab8c4, skyBot: 0xc4d0da, sunColor: 0xe8eef4,
    fogColor: 0xb8c4d0, fogNear: 18, fogFar: 190,
    sunIntensity: 0.8, hemiIntensity: 0.8, exposure: 1.0,
    sunOffset: [60, 140, 30], rain: 0, roadRough: 0.85, roadEnv: 0.5,
    grip: 0.95, headlights: true, cloudColor: 0xc4d0da, cloudOpacity: 0.9, puddles: 0,
  },
  storm: {
    name: 'Tormenta', icon: '⛈️',
    skyTop: 0x2a3242, skyMid: 0x4a5568, skyBot: 0x6a7688, sunColor: 0xcfd8e8,
    fogColor: 0x5a6678, fogNear: 40, fogFar: 300,
    sunIntensity: 0.45, hemiIntensity: 0.5, exposure: 0.92,
    sunOffset: [50, 180, 20], rain: 1.8, roadRough: 0.15, roadEnv: 1.7,
    grip: 0.75, headlights: true, cloudColor: 0x4a5568, cloudOpacity: 1.0, puddles: 0.7,
  },
};

class WeatherManager {
  constructor(scene, track, renderer, audio, playerCar, onChange) {
    this.scene = scene;
    this.track = track;
    this.renderer = renderer;
    this.audio = audio;
    this.playerCar = playerCar;
    this.onChange = onChange || (() => {});
    this.currentName = 'clear';
    this.lightningTimer = 4;
    this.flash = 0;
    this.thunderTimer = -1;

    // Estado actual (interpola hacia el objetivo)
    const p = WEATHER_PRESETS.clear;
    this.cur = {
      skyTop: new THREE.Color(p.skyTop), skyMid: new THREE.Color(p.skyMid),
      skyBot: new THREE.Color(p.skyBot), sunColor: new THREE.Color(p.sunColor),
      fogColor: new THREE.Color(p.fogColor), cloudColor: new THREE.Color(p.cloudColor),
      fogNear: p.fogNear, fogFar: p.fogFar, sunIntensity: p.sunIntensity,
      hemiIntensity: p.hemiIntensity, exposure: p.exposure, rain: 0,
      roadRough: p.roadRough, roadEnv: p.roadEnv, grip: 1,
      cloudOpacity: p.cloudOpacity, puddles: 0,
      sunOffset: new THREE.Vector3(...p.sunOffset),
    };
    this.target = this._presetToState(p);

    this._buildRain();
    this._buildClouds();
    this._apply(1); // aplicar estado inicial sin transición
  }

  _presetToState(p) {
    return {
      skyTop: new THREE.Color(p.skyTop), skyMid: new THREE.Color(p.skyMid),
      skyBot: new THREE.Color(p.skyBot), sunColor: new THREE.Color(p.sunColor),
      fogColor: new THREE.Color(p.fogColor), cloudColor: new THREE.Color(p.cloudColor),
      fogNear: p.fogNear, fogFar: p.fogFar, sunIntensity: p.sunIntensity,
      hemiIntensity: p.hemiIntensity, exposure: p.exposure, rain: p.rain,
      roadRough: p.roadRough, roadEnv: p.roadEnv, grip: p.grip,
      cloudOpacity: p.cloudOpacity, puddles: p.puddles,
      sunOffset: new THREE.Vector3(...p.sunOffset),
      headlights: p.headlights,
    };
  }

  setWeather(name) {
    if (!WEATHER_PRESETS[name]) return;
    this.currentName = name;
    this.target = this._presetToState(WEATHER_PRESETS[name]);
    this.playerCar.setHeadlights(this.target.headlights);
    this.onChange(WEATHER_PRESETS[name]);
  }

  cycle() {
    const i = WEATHER_ORDER.indexOf(this.currentName);
    this.setWeather(WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length]);
  }

  get gripFactor() { return this.cur.grip; }
  get rainLevel() { return this.cur.rain; }

  /* ---------- Lluvia de partículas ---------- */
  _buildRain() {
    const COUNT = 2600;
    this.rainCount = COUNT;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = Math.random() * 45;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainGeo = geo;
    const mat = new THREE.PointsMaterial({
      color: 0xaaccee, size: 0.16, transparent: true, opacity: 0.65,
      depthWrite: false, sizeAttenuation: true,
    });
    this.rain = new THREE.Points(geo, mat);
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  _updateRain(dt, focusPos) {
    const level = this.cur.rain;
    this.rain.visible = level > 0.05;
    if (!this.rain.visible) return;
    this.rain.position.set(focusPos.x, 0, focusPos.z);
    const shown = Math.floor(this.rainCount * clamp(level / 1.8, 0, 1));
    this.rainGeo.setDrawRange(0, shown);
    const arr = this.rainGeo.attributes.position.array;
    const fall = 55 * dt;
    for (let i = 0; i < shown; i++) {
      arr[i * 3 + 1] -= fall;
      arr[i * 3] += 4 * dt; // viento lateral
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 40 + Math.random() * 6;
        arr[i * 3] = (Math.random() - 0.5) * 70;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 70;
      }
    }
    this.rainGeo.attributes.position.needsUpdate = true;
  }

  /* ---------- Nubes bajas ---------- */
  _buildClouds() {
    this.cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      roughness: 1, flatShading: true, depthWrite: false,
    });
    this.clouds = new THREE.Group();
    const geo = new THREE.SphereGeometry(1, 7, 5);
    for (let i = 0; i < 20; i++) {
      const c = new THREE.Mesh(geo, this.cloudMaterial);
      c.position.set((Math.random() - 0.5) * 800, 95 + Math.random() * 45, (Math.random() - 0.5) * 800);
      c.scale.set(22 + Math.random() * 26, 4 + Math.random() * 3, 12 + Math.random() * 14);
      this.clouds.add(c);
    }
    this.scene.add(this.clouds);
  }

  /* ---------- Actualización por frame ---------- */
  update(dt, focusPos) {
    const k = 1 - Math.exp(-dt * 0.9); // transición suave (~2-3 s)
    const c = this.cur, t = this.target;
    c.skyTop.lerp(t.skyTop, k); c.skyMid.lerp(t.skyMid, k);
    c.skyBot.lerp(t.skyBot, k); c.sunColor.lerp(t.sunColor, k);
    c.fogColor.lerp(t.fogColor, k); c.cloudColor.lerp(t.cloudColor, k);
    c.sunOffset.lerp(t.sunOffset, k);
    for (const key of ['fogNear', 'fogFar', 'sunIntensity', 'hemiIntensity', 'exposure', 'rain', 'roadRough', 'roadEnv', 'grip', 'cloudOpacity', 'puddles']) {
      c[key] = lerp(c[key], t[key], k);
    }
    this._apply(1);

    // Nubes a la deriva
    this.clouds.children.forEach((cl) => {
      cl.position.x += dt * 2.2;
      if (cl.position.x > 450) cl.position.x = -450;
    });

    this._updateRain(dt, focusPos);
    this.audio.setRainLevel(clamp(this.cur.rain / 1.8, 0, 1));

    // Rayos en la tormenta
    if (this.currentName === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.flash = 1;
        this.thunderTimer = 0.5 + Math.random() * 1.2;
        this.lightningTimer = 3 + Math.random() * 6;
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      const f = this.flash * (Math.random() > 0.4 ? 1 : 0.3); // parpadeo
      this.track.hemi.intensity = this.cur.hemiIntensity + f * 3.2;
      this.track.sun.intensity = this.cur.sunIntensity + f * 2.5;
    }
    if (this.thunderTimer > 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) this.audio.thunder();
    }
  }

  _apply() {
    const c = this.cur;
    const sky = this.track.skyMaterial.uniforms;
    sky.top.value.copy(c.skyTop); sky.mid.value.copy(c.skyMid); sky.bot.value.copy(c.skyBot);
    sky.sunColor.value.copy(c.sunColor);
    sky.sunDir.value.copy(c.sunOffset).normalize();
    this.track.sun.color.copy(c.sunColor);
    this.track.sunOffset.copy(c.sunOffset);
    if (this.flash <= 0) {
      this.track.sun.intensity = c.sunIntensity;
      this.track.hemi.intensity = c.hemiIntensity;
    }
    this.scene.fog.color.copy(c.fogColor);
    this.scene.fog.near = c.fogNear;
    this.scene.fog.far = c.fogFar;
    this.renderer.toneMappingExposure = c.exposure;
    // Asfalto mojado: menos rugoso, más reflejo, más oscuro
    this.track.roadMaterial.roughness = c.roadRough;
    this.track.roadMaterial.envMapIntensity = c.roadEnv;
    const wetDark = 1 - c.rain * 0.14;
    this.track.roadMaterial.color.setScalar(wetDark);
    this.track.puddleMaterial.opacity = c.puddles;
    this.cloudMaterial.color.copy(c.cloudColor);
    this.cloudMaterial.opacity = c.cloudOpacity;
  }
}

/* ============================================================
   HUD — velocímetro, minimapa 2D, tiempos, clima y mensajes
   ============================================================ */
class HUD {
  constructor(track) {
    this.el = {
      hud: document.getElementById('hud'),
      lap: document.getElementById('hud-lap'),
      time: document.getElementById('hud-time'),
      lapTime: document.getElementById('hud-laptime'),
      best: document.getElementById('hud-best'),
      position: document.getElementById('hud-position'),
      speed: document.getElementById('hud-speed'),
      needle: document.getElementById('speedo-needle'),
      gear: document.getElementById('hud-gear'),
      center: document.getElementById('hud-center-message'),
      drift: document.getElementById('hud-drift'),
      weather: document.getElementById('hud-weather'),
      toast: document.getElementById('weather-toast'),
      minimap: document.getElementById('minimap'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const scale = Math.min((W - 24) / (maxX - minX), (H - 24) / (maxZ - minZ));
    this.mapScale = scale;
    this.mapOx = (W - (maxX - minX) * scale) / 2 - minX * scale;
    this.mapOz = (H - (maxZ - minZ) * scale) / 2 - minZ * scale;
    this.trackSamples = track.samples;
    this._toastTimer = null;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  showCenter(text, isGo = false) {
    this.el.center.textContent = text;
    this.el.center.classList.toggle('go', isGo);
    this.el.center.classList.remove('hidden');
  }
  hideCenter() { this.el.center.classList.add('hidden'); }

  setWeather(preset) {
    this.el.weather.textContent = `${preset.icon} ${preset.name}`;
    this.el.toast.textContent = `${preset.icon} Clima: ${preset.name}`;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.add('hidden'), 2600);
  }

  update({ speedKmh, gear, lap, totalLaps, position, raceTime, lapTime, bestLap, drifting, playerPos, aiCars }) {
    this.el.lap.textContent = `${Math.min(lap, totalLaps)}/${totalLaps}`;
    this.el.time.textContent = formatTime(raceTime);
    this.el.lapTime.textContent = formatTime(lapTime);
    this.el.best.textContent = formatTime(bestLap);
    this.el.position.textContent = `${position}º`;
    this.el.speed.textContent = Math.round(speedKmh);
    this.el.gear.textContent = gear;
    const angle = -120 + clamp(speedKmh / 240, 0, 1) * 240;
    this.el.needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    this.el.drift.classList.toggle('hidden', !drifting);
    this._drawMinimap(playerPos, aiCars);
  }

  _toMap(x, z) { return [x * this.mapScale + this.mapOx, z * this.mapScale + this.mapOz]; }

  _drawMinimap(playerPos, aiCars) {
    const g = this.mapCtx, W = this.el.minimap.width, H = this.el.minimap.height;
    g.clearRect(0, 0, W, H);
    g.beginPath();
    for (let i = 0; i < this.trackSamples.length; i += 4) {
      const [x, y] = this._toMap(this.trackSamples[i].x, this.trackSamples[i].z);
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = 'rgba(0,229,255,0.35)'; g.lineWidth = 6; g.stroke();
    const dot = (pos, color, r) => {
      const [x, y] = this._toMap(pos.x, pos.z);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = color; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.stroke();
    };
    aiCars.forEach((ai) => dot(ai.car.group.position, ai.colorCss, 4));
    dot(playerPos, '#ffffff', 5);
  }
}

/* ============================================================
   Game — orquesta la partida: estados, cuenta atrás, vueltas
   con checkpoints, posiciones, colisiones, cámaras, clima,
   sombras dinámicas, postprocesado y modelos GLB.
   ============================================================ */
const TOTAL_LAPS = 3;
const BEST_LAP_KEY = 'pedusApexBestLap';

class Game {
  constructor() {
    this.state = 'menu';
    this.cameraMode = 0;
    this.raceTime = 0;
    this.lapStartTime = 0;
    this.bestLap = this._loadBestLap();
    this.countdownT = 0;
    this.lastCountShown = -1;
    this.goT = 0;
    this.menuOrbit = 0;
    this.cameraShake = 0;
    this.weatherTimer = 55; // cambio automático de clima

    this._initRenderer();
    this._initScene();
    this.input = new InputManager();
    this.audio = new AudioManager();
    this.track = new Track(this.scene, this.renderer.capabilities.getMaxAnisotropy());
    this.hud = new HUD(this.track);

    this.player = new Car(this.scene, 0xe63946, 'Tú');
    this.ai = [
      new AIController(new Car(this.scene, 0x1d3557, 'Rival 1'), this.track, 47, '#ff2d55'),
      new AIController(new Car(this.scene, 0xffd60a, 'Rival 2'), this.track, 44, '#ffd60a'),
      new AIController(new Car(this.scene, 0x00b4d8, 'Rival 3'), this.track, 41, '#00e5ff'),
    ];

    // Clima dinámico (con faros del jugador y aviso en el HUD)
    this.weather = new WeatherManager(
      this.scene, this.track, this.renderer, this.audio, this.player,
      (preset) => this.hud.setWeather(preset)
    );

    this._resetRace();
    this._bindUI();
    this.input.onAction = (code) => this._onActionKey(code);

    // Cargar tus modelos GLB en segundo plano (no bloquea el juego)
    if (USE_GLB_MODELS) this._loadGLBModels();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._loop());
  }

  /* ---------- Renderizado: entorno, sombras y postprocesado ---------- */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('game-container').appendChild(this.renderer.domElement);

    // Entorno para reflejos realistas en pinturas y asfalto mojado
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;

    // Postprocesado: Bloom sutil (solo brilla lo muy luminoso: faros, sol)
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.65, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 60, 180);
  }

  /* ---------- Carga de modelos .glb o .obj (con .mtl opcional) ---------- */
  /** Carga un .obj y, si existe, su .mtl del mismo nombre (colores/texturas) */
  async _loadOBJ(url) {
    const objLoader = new OBJLoader();
    try {
      const mtlUrl = url.replace(/\.obj$/i, '.mtl');
      const materials = await new MTLLoader().loadAsync(mtlUrl);
      materials.preload();
      objLoader.setMaterials(materials);
    } catch {
      // Sin .mtl: se carga solo la geometría (material neutro)
    }
    const obj = await objLoader.loadAsync(url);
    obj.traverse((o) => {
      if (o.isMesh && !o.material) o.material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.7 });
    });
    return obj;
  }

  /**
   * Carga un modelo aceptando .glb o .obj: prueba la URL configurada
   * y, si falla, la misma ruta con la otra extensión. Devuelve el
   * Object3D o null si no existe ninguno (→ procedural).
   */
  async _loadModelFile(url) {
    const alt = url.replace(/\.(glb|gltf|obj)$/i, (m) => (m.toLowerCase() === '.obj' ? '.glb' : '.obj'));
    for (const u of [url, alt]) {
      try {
        if (/\.obj$/i.test(u)) return await this._loadOBJ(u);
        const gltf = await this._gltfLoader.loadAsync(u);
        return gltf.scene;
      } catch {
        // Probar la siguiente extensión
      }
    }
    return null;
  }

  /* ---------- Carga de los 5 modelos (.glb o .obj) ---------- */
  async _loadGLBModels() {
    const statusEl = document.getElementById('model-status');
    this._gltfLoader = new GLTFLoader();
    const results = {};
    const tasks = [];

    // Coche del jugador
    tasks.push(this._loadModelFile(GLB_MODELS.playerCar).then((scene) => {
      if (scene) this.player.applyGLBModel(scene);
      results.playerCar = !!scene;
    }));

    // Coche rival (se clona en los 3 IA)
    let rivalScene = null;
    tasks.push(this._loadModelFile(GLB_MODELS.rivalCar).then((scene) => {
      rivalScene = scene;
      results.rivalCar = !!scene;
    }));

    // Escenario: árbol, montaña y grada
    tasks.push(this._loadModelFile(GLB_MODELS.tree).then((scene) => {
      let mesh = null;
      if (scene) scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (mesh) this.track.replaceTrees(mesh.geometry, mesh.material.clone());
      results.tree = !!mesh;
    }));

    tasks.push(this._loadModelFile(GLB_MODELS.mountain).then((scene) => {
      let mesh = null;
      if (scene) scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (mesh) this.track.replaceMountains(mesh.geometry, mesh.material.clone());
      results.mountain = !!mesh;
    }));

    tasks.push(this._loadModelFile(GLB_MODELS.grandstand).then((scene) => {
      if (scene) this.track.replaceGrandstands(scene);
      results.grandstand = !!scene;
    }));

    await Promise.allSettled(tasks);

    if (rivalScene) {
      for (const ai of this.ai) ai.car.applyGLBModel(rivalScene.clone(true));
    }

    const loaded = Object.values(results).filter(Boolean).length;
    if (statusEl) {
      if (loaded === 5) {
        statusEl.textContent = '✅ Modelos 3D cargados: 5/5 (.glb/.obj activos)';
        statusEl.className = 'model-status ok';
      } else if (loaded > 0) {
        statusEl.textContent = `⚠️ Modelos 3D cargados: ${loaded}/5 (el resto usa gráficos procedurales)`;
        statusEl.className = 'model-status partial';
      } else {
        statusEl.textContent = 'ℹ️ Sin modelos en models/ (.glb o .obj): usando gráficos procedurales (ver README.md)';
        statusEl.className = 'model-status partial';
      }
    }
    console.info('[Modelos] Resultado de carga (.glb/.obj):', results);
  }

  /* ---------- Persistencia ---------- */
  _loadBestLap() {
    try {
      const v = localStorage.getItem(BEST_LAP_KEY);
      return v ? parseInt(v, 10) : null;
    } catch { return null; }
  }
  _saveBestLap(ms) {
    try { localStorage.setItem(BEST_LAP_KEY, String(Math.round(ms))); } catch { /* no disponible */ }
  }

  /* ---------- Parrilla y reinicio ---------- */
  _resetRace() {
    this.ai[0].placeAt(0.030, 3.2);
    this.ai[1].placeAt(0.020, -3.2);
    this.ai[2].placeAt(0.010, 3.2);
    const pPos = this.track.positionAt(0.004, -3.2);
    const pTan = this.track.tangentAt(0.004);
    this.player.placeAt(pPos, Math.atan2(pTan.x, pTan.z));

    this.raceTime = 0;
    this.lapStartTime = 0;
    this.lap = 1;
    this.playerProgress = 0.004;
    this.prevU = 0.004;
    this.nearestHint = Math.floor(0.004 * 1000);
    this.checkpointsPassed = [true, false, false, false];
    this.nextCheckpoint = 1;
    this.prevSector = 0;
    this.cameraMode = 0;
    this.cameraShake = 0;
  }

  /* ---------- Interfaz ---------- */
  _bindUI() {
    const $ = (id) => document.getElementById(id);
    const show = (id) => $(id).classList.remove('hidden');
    const hide = (id) => $(id).classList.add('hidden');
    this._ui = { show, hide, $ };

    $('btn-play').addEventListener('click', () => this.startRace());
    $('btn-controls').addEventListener('click', () => { hide('main-menu'); show('controls-panel'); });
    $('btn-controls-back').addEventListener('click', () => { hide('controls-panel'); show('main-menu'); });
    $('btn-resume').addEventListener('click', () => this.togglePause());
    $('btn-restart').addEventListener('click', () => { hide('pause-menu'); this.startRace(); });
    $('btn-quit').addEventListener('click', () => { hide('pause-menu'); this.toMenu(); });
    $('btn-retry').addEventListener('click', () => { hide('results-menu'); this.startRace(); });
    $('btn-results-menu').addEventListener('click', () => { hide('results-menu'); this.toMenu(); });
    $('btn-mute').addEventListener('click', () => this.toggleMute());
    $('btn-weather').addEventListener('click', () => this.weather.cycle());
    $('btn-pause').addEventListener('click', () => { if (this.state === 'racing') this.togglePause(); });

    if (this.bestLap) {
      $('menu-best').textContent = `🏆 Mejor vuelta: ${formatTime(this.bestLap)}`;
      $('menu-best').classList.remove('hidden');
    }
  }

  _onActionKey(code) {
    if (code === 'KeyR' && this.state === 'racing') this.respawn();
    if (code === 'KeyC') this.cameraMode = (this.cameraMode + 1) % 2;
    if (code === 'KeyT') this.weather.cycle();
    if (code === 'KeyP' || code === 'Escape') {
      if (this.state === 'racing' || this.state === 'paused') this.togglePause();
    }
    if (code === 'KeyM') this.toggleMute();
  }

  toggleMute() {
    const muted = this.audio.toggleMute();
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  }

  /* ---------- Flujo de estados ---------- */
  startRace() {
    this._resetRace();
    this._ui.hide('main-menu'); this._ui.hide('results-menu'); this._ui.hide('pause-menu');
    this._ui.show('hud');
    this.audio.init();
    this.state = 'countdown';
    this.countdownT = 3.2;
    this.lastCountShown = -1;
  }

  toMenu() {
    this.state = 'menu';
    this._ui.hide('hud'); this._ui.hide('pause-menu'); this._ui.hide('results-menu');
    this._ui.show('main-menu');
    this.hud.hideCenter();
    if (this.bestLap) {
      const el = document.getElementById('menu-best');
      el.textContent = `🏆 Mejor vuelta: ${formatTime(this.bestLap)}`;
      el.classList.remove('hidden');
    }
  }

  togglePause() {
    if (this.state === 'racing') {
      this.state = 'paused';
      this._ui.show('pause-menu');
      this.audio.update(0, false, false);
      this.audio.setRainLevel(0);
    } else if (this.state === 'paused') {
      this.state = 'racing';
      this._ui.hide('pause-menu');
      this.clock.getDelta();
    }
  }

  respawn() {
    const near = this.track.findNearest(this.player.group.position, this.nearestHint);
    const pos = this.track.positionAt(near.u, 0);
    const t = this.track.tangentAt(near.u);
    this.player.placeAt(pos, Math.atan2(t.x, t.z));
    this.prevU = near.u;
    this.nearestHint = near.index;
    this.prevSector = Math.floor(near.u * 4) % 4;
  }

  finishRace() {
    this.state = 'finished';
    const pos = this._computePosition();
    document.getElementById('results-position').textContent = `${pos}º`;
    document.getElementById('results-title').textContent =
      pos === 1 ? '🏆 ¡VICTORIA!' : pos <= 3 ? '¡PODIO!' : '¡CARRERA TERMINADA!';
    document.getElementById('results-total').textContent = formatTime(this.raceTime);
    document.getElementById('results-best').textContent = formatTime(this.lastLapTime || null);
    document.getElementById('results-record').textContent = formatTime(this.bestLap);
    this._ui.show('results-menu');
    this.audio.beep(pos === 1 ? 880 : 520, 0.4, 'triangle');
  }

  /* ---------- Vueltas con checkpoints anti-trampa ---------- */
  _updateLapLogic(u) {
    const sector = Math.floor(u * 4) % 4;
    if (this.prevSector === 3 && sector === 0) {
      if (this.checkpointsPassed.every(Boolean)) {
        this.lastLapTime = this.raceTime - this.lapStartTime;
        if (!this.bestLap || this.lastLapTime < this.bestLap) {
          this.bestLap = this.lastLapTime;
          this._saveBestLap(this.bestLap);
        }
        this.lapStartTime = this.raceTime;
        this.lap++;
        this.checkpointsPassed = [false, false, false, false];
        this.nextCheckpoint = 0;
        this.audio.beep(660, 0.12, 'triangle');
        if (this.lap > TOTAL_LAPS) { this.finishRace(); return; }
      }
    }
    if (sector === this.nextCheckpoint) {
      this.checkpointsPassed[sector] = true;
      this.nextCheckpoint = (this.nextCheckpoint + 1) % 4;
    }
    this.prevSector = sector;
  }

  _computePosition() {
    const all = [{ p: this.playerProgress }, ...this.ai.map((a) => ({ p: a.progress }))];
    all.sort((a, b) => b.p - a.p);
    return all.findIndex((e) => e.p === this.playerProgress) + 1;
  }

  _handleCollisions(dt) {
    const pp = this.player.group.position;
    for (const ai of this.ai) {
      const ap = ai.car.group.position;
      const dx = pp.x - ap.x, dz = pp.z - ap.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3.4 && dist > 0.001) {
        const push = (3.4 - dist) * 6 * dt;
        pp.x += (dx / dist) * push;
        pp.z += (dz / dist) * push;
        this.player.velocity.multiplyScalar(0.82);
        this.cameraShake = Math.min(1, this.cameraShake + 0.35);
        ai.lateral += (dx / dist) * 0.4;
      }
    }
  }

  /* ---------- Cámara ---------- */
  _updateCamera(dt) {
    const car = this.player;
    const fwd = car.forward;
    if (this.cameraMode === 1) {
      const target = car.group.position.clone().addScaledVector(fwd, 0.6).add(new THREE.Vector3(0, 1.25, 0));
      this.camera.position.lerp(target, Math.min(1, dt * 18));
      this.camera.lookAt(target.clone().addScaledVector(fwd, 10));
    } else {
      const desired = car.group.position.clone()
        .addScaledVector(fwd, -10.5)
        .add(new THREE.Vector3(0, 4.2, 0));
      this.camera.position.lerp(desired, Math.min(1, dt * 5.5));
      const look = car.group.position.clone().addScaledVector(fwd, 6).add(new THREE.Vector3(0, 1.2, 0));
      if (this.cameraShake > 0.01) {
        look.x += (Math.random() - 0.5) * this.cameraShake;
        look.y += (Math.random() - 0.5) * this.cameraShake;
        this.cameraShake *= Math.exp(-6 * dt);
      }
      this.camera.lookAt(look);
    }
    const ratio = clamp(Math.abs(car.speed) / car.maxSpeed, 0, 1);
    const targetFov = 62 + ratio * 18;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = lerp(this.camera.fov, targetFov, Math.min(1, dt * 4));
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---------- Bucle principal ---------- */
  _loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // El clima y las sombras se actualizan siempre (también en el menú)
    const focus = this.player.group.position;
    this.weather.update(dt, focus);
    this.track.updateShadowFollow(focus);

    if (this.state === 'menu' || this.state === 'finished') {
      this.menuOrbit += dt * 0.08;
      this.camera.position.set(Math.cos(this.menuOrbit) * 190, 65, Math.sin(this.menuOrbit) * 190);
      this.camera.lookAt(0, 0, 0);
      if (this.camera.fov !== 62) { this.camera.fov = 62; this.camera.updateProjectionMatrix(); }
    } else if (this.state === 'countdown') {
      this._updateCountdown(dt);
      this._updateCamera(dt);
    } else if (this.state === 'racing') {
      this._updateRacing(dt);
    } else if (this.state === 'paused') {
      // Congelado: solo se renderiza
    }

    this.composer.render();
  }

  _updateCountdown(dt) {
    this.countdownT -= dt;
    const shown = Math.ceil(this.countdownT);
    if (shown !== this.lastCountShown && shown >= 1) {
      this.lastCountShown = shown;
      this.hud.showCenter(String(shown));
      this.audio.beep(440, 0.15);
    }
    if (this.countdownT <= 0) {
      this.state = 'racing';
      this.hud.showCenter('¡YA!', true);
      this.audio.beep(880, 0.35);
      this.goT = 0.9;
      this.raceTime = 0;
      this.lapStartTime = 0;
    }
    this._updateHUD();
  }

  _updateRacing(dt) {
    this.raceTime += dt;
    if (this.goT > 0) { this.goT -= dt; if (this.goT <= 0) this.hud.hideCenter(); }

    // Cambio automático de clima cada ~55 s
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weather.cycle();
      this.weatherTimer = 55;
    }
    const grip = this.weather.gripFactor;

    const input = this.input.getInput();
    const near = this.track.findNearest(this.player.group.position, this.nearestHint);
    this.nearestHint = near.index;
    const onTrack = near.distance <= this.track.halfWidth + 1.2;
    this.player.update(dt, input, onTrack, grip);

    let d = wrapDelta(near.u - this.prevU);
    d = clamp(d, -0.02, 0.02);
    this.playerProgress += d;
    this.prevU = near.u;

    this._updateLapLogic(near.u);

    for (const ai of this.ai) ai.update(dt, this.playerProgress, grip);

    this._handleCollisions(dt);
    this._updateCamera(dt);
    const ratio = clamp(Math.abs(this.player.speed) / this.player.maxSpeed, 0, 1);
    this.audio.update(ratio, this.player.drifting, input.throttle === 1);
    this._updateHUD();
  }

  _updateHUD() {
    const gear = Math.abs(this.player.speed) < 1 ? 'N' : (this.player.speed < -0.5 ? 'R' : 'D');
    this.hud.update({
      speedKmh: this.player.speedKmh(),
      gear,
      lap: this.lap,
      totalLaps: TOTAL_LAPS,
      position: this._computePosition(),
      raceTime: this.raceTime,
      lapTime: this.raceTime - this.lapStartTime,
      bestLap: this.bestLap,
      drifting: this.player.drifting,
      playerPos: this.player.group.position,
      aiCars: this.ai,
    });
  }
}

/* ---------- Arranque ---------- */
new Game();
