import * as THREE from "three";
import type { AircraftSpec } from "./aircraft";

const clamp = THREE.MathUtils.clamp;

export interface AudioParams {
  eng: number; // 0..1 rotação / empuxo efetivo
  ab: boolean; // pós-combustão ativa
  speed: number; // m/s (TAS)
  alpha: number; // ângulo de ataque (rad)
  agl: number; // altura acima do solo (m)
  gearPos: number; // 0..1
  spoilerPos: number; // 0..1
  inCloud: number; // 0..1 densidade de nuvem ao redor
  cockpit: boolean; // câmera dentro da cabine?
  /** posição da fonte sonora (aeronave própria ou seguida) */
  srcPos: THREE.Vector3;
  srcVel: THREE.Vector3;
  srcFwd: THREE.Vector3;
  /** posição e velocidade da câmera (ouvinte) */
  camPos: THREE.Vector3;
  camVel: THREE.Vector3;
  /** quando true (acompanhando voo ADS-B), modula com base no modelo seguido */
  followingExternal?: boolean;
  isJetOverride?: boolean;
}

/**
 * Motor de áudio aeronáutico em Web Audio API:
 * - Síntese em camadas (ruído rosa/marrom filtrados + harmônicos de N1 / pás de hélice)
 * - Diferenciação cabine vs. externo + direcionalidade do escape
 * - Reflexão sonora do solo/terreno (multi-tap delay)
 * - Efeito Doppler contínuo pela velocidade radial fonte↔câmera + absorção atmosférica
 * - Sons mecânicos: trem de pouso (hidráulico + trava), spoiler, impacto + chiado no pouso
 */
export class FlightAudio {
  ctx: AudioContext;
  master: GainNode;

  // buses
  private planeBus: GainNode;
  private cabinFilter: BiquadFilterNode;
  private reflTap1: DelayNode;
  private reflTap2: DelayNode;
  private reflGain: GainNode;
  private distFilter: BiquadFilterNode;

  // camadas do motor
  private jetRumbleSrc: AudioBufferSourceNode;
  private jetRumbleFilter: BiquadFilterNode;
  private jetRumbleGain: GainNode;

  private jetRoarSrc: AudioBufferSourceNode;
  private jetRoarFilter: BiquadFilterNode;
  private jetRoarGain: GainNode;

  private abSrc: AudioBufferSourceNode;
  private abFilter: BiquadFilterNode;
  private abGain: GainNode;

  private turbineOsc1: OscillatorNode;
  private turbineOsc2: OscillatorNode;
  private turbineGain: GainNode;

  private propOsc: OscillatorNode | null = null;
  private propGain: GainNode | null = null;

  // aerodinâmica e vento
  private windLowSrc: AudioBufferSourceNode;
  private windLowFilter: BiquadFilterNode;
  private windLowGain: GainNode;

  private windAirSrc: AudioBufferSourceNode;
  private windAirFilter: BiquadFilterNode;
  private windAirGain: GainNode;

  private buffetSrc: AudioBufferSourceNode;
  private buffetFilter: BiquadFilterNode;
  private buffetGain: GainNode;

  private avionicsOsc: OscillatorNode;
  private avionicsGain: GainNode;

  private pinkBuf: AudioBuffer;
  private brownBuf: AudioBuffer;
  private whiteBuf: AudioBuffer;
  private isProp: boolean;
  private disposed = false;
  private muted = false;
  private baseVolume = 0.58;

  constructor(spec: AircraftSpec) {
    this.isProp = spec.propeller;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.58;
    this.baseVolume = 0.58;
    // compressor suave para evitar distorção em pós-combustão + explosões
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // buffers orgânicos de ruído rosa e marrom (muito menos sintéticos que ruído branco puro)
    this.whiteBuf = this.makeWhite(3);
    this.pinkBuf = this.makePink(4);
    this.brownBuf = this.makeBrown(4);

    // cadeia acústica da aeronave: fontes -> planeBus -> cabinFilter -> distFilter -> master
    //                                                         \-> reflTap1/2 -> reflGain -> master
    this.planeBus = ctx.createGain();
    this.planeBus.gain.value = 1;

    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = "lowpass";
    this.cabinFilter.frequency.value = 18000;
    this.cabinFilter.Q.value = 0.5;

    this.distFilter = ctx.createBiquadFilter();
    this.distFilter.type = "lowpass";
    this.distFilter.frequency.value = 18000;

    this.planeBus.connect(this.cabinFilter).connect(this.distFilter).connect(master);

    // reflexão sonora do solo / pista / hangares (early reflections)
    this.reflTap1 = ctx.createDelay(0.5);
    this.reflTap1.delayTime.value = 0.032;
    this.reflTap2 = ctx.createDelay(0.5);
    this.reflTap2.delayTime.value = 0.086;
    const reflFilter = ctx.createBiquadFilter();
    reflFilter.type = "lowpass";
    reflFilter.frequency.value = 1100;
    const reflFb = ctx.createGain();
    reflFb.gain.value = 0.25;
    this.reflGain = ctx.createGain();
    this.reflGain.gain.value = 0.12;
    this.distFilter.connect(this.reflTap1);
    this.reflTap1.connect(this.reflTap2);
    this.reflTap1.connect(reflFilter);
    this.reflTap2.connect(reflFilter);
    this.reflTap2.connect(reflFb).connect(this.reflTap1);
    reflFilter.connect(this.reflGain).connect(master);

    // ---- 1. Sub-grave do escape (jet rumble / motor)
    this.jetRumbleSrc = this.loopSrc(this.brownBuf);
    this.jetRumbleFilter = ctx.createBiquadFilter();
    this.jetRumbleFilter.type = "lowpass";
    this.jetRumbleFilter.frequency.value = 180;
    this.jetRumbleFilter.Q.value = 1.2;
    this.jetRumbleGain = ctx.createGain();
    this.jetRumbleGain.gain.value = 0;
    this.jetRumbleSrc.connect(this.jetRumbleFilter).connect(this.jetRumbleGain).connect(this.planeBus);

    // ---- 2. Sopro do jato (jet roar)
    this.jetRoarSrc = this.loopSrc(this.pinkBuf);
    this.jetRoarFilter = ctx.createBiquadFilter();
    this.jetRoarFilter.type = "bandpass";
    this.jetRoarFilter.frequency.value = 450;
    this.jetRoarFilter.Q.value = 0.55;
    this.jetRoarGain = ctx.createGain();
    this.jetRoarGain.gain.value = 0;
    this.jetRoarSrc.connect(this.jetRoarFilter).connect(this.jetRoarGain).connect(this.planeBus);

    // ---- 3. Estalo da pós-combustão (afterburner crackle)
    this.abSrc = this.loopSrc(this.whiteBuf);
    this.abFilter = ctx.createBiquadFilter();
    this.abFilter.type = "bandpass";
    this.abFilter.frequency.value = 950;
    this.abFilter.Q.value = 0.8;
    this.abGain = ctx.createGain();
    this.abGain.gain.value = 0;
    this.abSrc.connect(this.abFilter).connect(this.abGain).connect(this.planeBus);

    // ---- 4. Assovio de turbina / Fan N1
    this.turbineOsc1 = ctx.createOscillator();
    this.turbineOsc1.type = "sine";
    this.turbineOsc1.frequency.value = 320;
    this.turbineOsc2 = ctx.createOscillator();
    this.turbineOsc2.type = "triangle";
    this.turbineOsc2.frequency.value = 640;
    const t2g = ctx.createGain();
    t2g.gain.value = 0.3;
    const tf = ctx.createBiquadFilter();
    tf.type = "bandpass";
    tf.frequency.value = 900;
    tf.Q.value = 0.8;
    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.value = 0;
    this.turbineOsc1.connect(tf);
    this.turbineOsc2.connect(t2g).connect(tf);
    tf.connect(this.turbineGain).connect(this.planeBus);
    this.turbineOsc1.start();
    this.turbineOsc2.start();

    // ---- 5. Pulsação da hélice + motor a pistão (para C-172 e turboélices)
    if (this.isProp) {
      this.propOsc = ctx.createOscillator();
      this.propOsc.type = "sawtooth";
      this.propOsc.frequency.value = 42;
      const pf = ctx.createBiquadFilter();
      pf.type = "lowpass";
      pf.frequency.value = 220;
      pf.Q.value = 2.0;
      this.propGain = ctx.createGain();
      this.propGain.gain.value = 0;
      this.propOsc.connect(pf).connect(this.propGain).connect(this.planeBus);
      this.propOsc.start();
    }

    // ---- 6. Vento e fluxo aerodinâmico na fuselagem (não passa pelo cabinFilter como escape, tem sua própria presença interna!)
    this.windLowSrc = this.loopSrc(this.brownBuf);
    this.windLowFilter = ctx.createBiquadFilter();
    this.windLowFilter.type = "lowpass";
    this.windLowFilter.frequency.value = 240;
    this.windLowGain = ctx.createGain();
    this.windLowGain.gain.value = 0;
    this.windLowSrc.connect(this.windLowFilter).connect(this.windLowGain).connect(master);

    this.windAirSrc = this.loopSrc(this.pinkBuf);
    this.windAirFilter = ctx.createBiquadFilter();
    this.windAirFilter.type = "bandpass";
    this.windAirFilter.frequency.value = 900;
    this.windAirFilter.Q.value = 0.55;
    this.windAirGain = ctx.createGain();
    this.windAirGain.gain.value = 0;
    this.windAirSrc.connect(this.windAirFilter).connect(this.windAirGain).connect(master);

    // ---- 7. Buffet / turbulência (trem, spoiler, estol, nuvens densas)
    this.buffetSrc = this.loopSrc(this.pinkBuf);
    this.buffetFilter = ctx.createBiquadFilter();
    this.buffetFilter.type = "lowpass";
    this.buffetFilter.frequency.value = 280;
    this.buffetGain = ctx.createGain();
    this.buffetGain.gain.value = 0;
    this.buffetSrc.connect(this.buffetFilter).connect(this.buffetGain).connect(master);

    // ---- 8. Aviônica / giroscópio sutil dentro da cabine
    this.avionicsOsc = ctx.createOscillator();
    this.avionicsOsc.type = "sine";
    this.avionicsOsc.frequency.value = 400; // 400 Hz típico de barramento AC aeronáutico!
    this.avionicsGain = ctx.createGain();
    this.avionicsGain.gain.value = 0;
    this.avionicsOsc.connect(this.avionicsGain).connect(master);
    this.avionicsOsc.start();
  }

  private loopSrc(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  private makeWhite(sec: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** Ruído rosa (1/f, Voss-McCartney / Paul Kellet) — soa natural como vento e jato */
  private makePink(sec: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return b;
  }

  /** Ruído marrom (1/f²) com fade de loop perfeito — soa como sub-grave de turbina */
  private makeBrown(sec: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.025 * w) / 1.025;
      d[i] = clamp(last * 3.2, -1, 1);
    }
    // crossfade nos extremos para loop sem cliques
    const fade = 512;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
    return b;
  }

  private toCam = new THREE.Vector3();

  /** Mute global: zera o barramento mestre (sem parar a geração de áudio) */
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.baseVolume, this.ctx.currentTime, 0.03);
  }

  get isMuted() {
    return this.muted;
  }

  /** Atualiza todo o áudio contínuo a cada frame (Doppler, cabine/externo, reflexão, vento) */
  update(p: AudioParams) {
    if (this.disposed) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const t = this.ctx.currentTime;
    const dt = 0.06;

    // 1. Distância + Efeito Doppler entre aeronave (fonte) e câmera (ouvinte)
    this.toCam.copy(p.srcPos).sub(p.camPos);
    const dist = Math.max(1, this.toCam.length());
    const u = this.toCam.divideScalar(dist); // unidade câmera -> aeronave
    // velocidade relativa de aproximação: positiva quando a aeronave se aproxima da câmera
    const vr = p.camVel.clone().sub(p.srcVel).dot(u);
    const cSound = 343;
    const doppler = p.cockpit ? 1.0 : clamp(cSound / Math.max(85, cSound - vr), 0.55, 1.65);

    // atenuação por distância + absorção atmosférica das frequências altas
    const distAtt = p.cockpit ? 1.0 : clamp(1 / (1 + Math.max(0, dist - 28) / 150), 0.03, 1);
    const airCutoff = p.cockpit ? 18000 : clamp(16000 / (1 + dist / 450), 900, 16000);
    this.distFilter.frequency.setTargetAtTime(airCutoff, t, dt);

    // direcionalidade do escape: atrás do avião (u alinhado com srcFwd) o som do jato fica muito mais forte!
    const rearFactor = p.cockpit ? 0.55 : clamp(0.65 + 0.55 * u.dot(p.srcFwd), 0.45, 1.25);

    // 2. Cabine vs. Externo
    this.cabinFilter.frequency.setTargetAtTime(p.cockpit ? 920 : 18000, t, 0.08);
    this.avionicsGain.gain.setTargetAtTime(p.cockpit ? 0.012 : 0, t, 0.15);

    // 3. Reflexão sonora do terreno (perto do chão / pista / torre / passagem baixa)
    const groundRefl = p.cockpit
      ? clamp(1 - p.agl / 90, 0, 1) * 0.07
      : clamp(1 - p.agl / 220, 0.04, 1) * 0.24 * distAtt;
    this.reflGain.gain.setTargetAtTime(groundRefl, t, 0.12);

    // 4. Motores
    const propMode = p.isJetOverride !== undefined ? !p.isJetOverride : this.isProp;
    const e = clamp(p.eng, 0, 1);

    if (propMode) {
      const rpmHz = (28 + e * 52) * doppler;
      if (this.propOsc && this.propGain) {
        this.propOsc.frequency.setTargetAtTime(rpmHz, t, 0.05);
        this.propGain.gain.setTargetAtTime((p.cockpit ? 0.16 : 0.22) * (0.35 + 0.65 * e) * distAtt, t, 0.08);
      }
      this.jetRumbleGain.gain.setTargetAtTime((0.08 + 0.14 * e) * distAtt, t, 0.1);
      this.jetRumbleFilter.frequency.setTargetAtTime((120 + 180 * e) * doppler, t, 0.08);
      this.jetRumbleSrc.playbackRate.setTargetAtTime(doppler, t, 0.04);
      this.jetRoarGain.gain.setTargetAtTime(0.03 * e * distAtt, t, 0.1);
      this.abGain.gain.setTargetAtTime(0, t, 0.08);
      this.turbineGain.gain.setTargetAtTime(0, t, 0.08);
    } else {
      if (this.propGain) this.propGain.gain.setTargetAtTime(0, t, 0.1);
      const extMul = p.cockpit ? 0.55 : 1.0;
      this.jetRumbleSrc.playbackRate.setTargetAtTime((0.8 + 0.35 * e) * doppler, t, 0.04);
      this.jetRumbleFilter.frequency.setTargetAtTime((140 + 280 * e + (p.ab ? 160 : 0)) * doppler, t, 0.08);
      this.jetRumbleGain.gain.setTargetAtTime((0.09 + 0.36 * e + (p.ab ? 0.22 : 0)) * rearFactor * distAtt, t, 0.08);

      this.jetRoarSrc.playbackRate.setTargetAtTime((0.75 + 0.45 * e) * doppler, t, 0.04);
      this.jetRoarFilter.frequency.setTargetAtTime((240 + 1150 * e) * doppler, t, 0.08);
      this.jetRoarGain.gain.setTargetAtTime((0.03 + 0.26 * e) * extMul * rearFactor * distAtt, t, 0.08);

      // pós-combustão: rugido/estalo de plasma
      this.abSrc.playbackRate.setTargetAtTime((0.9 + Math.random() * 0.18) * doppler, t, 0.04);
      this.abGain.gain.setTargetAtTime(p.ab ? (p.cockpit ? 0.09 : 0.28) * rearFactor * distAtt : 0, t, 0.06);

      // assovio de turbina (mais audível em marcha lenta/média e de frente/cabine)
      const n1 = (240 + 580 * Math.pow(e, 0.75)) * doppler;
      this.turbineOsc1.frequency.setTargetAtTime(n1, t, 0.05);
      this.turbineOsc2.frequency.setTargetAtTime(n1 * 2.04, t, 0.05);
      const frontBias = p.cockpit ? 0.045 : clamp(0.035 - 0.02 * u.dot(p.srcFwd), 0.008, 0.045);
      this.turbineGain.gain.setTargetAtTime(frontBias * (0.25 + 0.75 * e) * distAtt, t, 0.1);
    }

    // 5. Aerodinâmica e vento realista (com ângulo de ataque, spoiler, trem e nuvem)
    const speedFrac = clamp(p.speed / 260, 0, 1.3);
    const windQ = speedFrac * speedFrac;
    const aoaDrag = clamp(Math.abs(p.alpha) / 0.35, 0, 1) * speedFrac;
    const gearWind = p.gearPos * speedFrac * 0.45;
    const spoilerWind = p.spoilerPos * speedFrac * 0.9;
    const windAudible = p.cockpit ? 1.0 : distAtt * 0.65;

    this.windLowSrc.playbackRate.setTargetAtTime((0.75 + 0.55 * speedFrac) * doppler, t, 0.06);
    this.windLowFilter.frequency.setTargetAtTime(clamp((120 + p.speed * 1.4 + spoilerWind * 200) * doppler, 90, 1200), t, 0.1);
    this.windLowGain.gain.setTargetAtTime(clamp((windQ * 0.24 + aoaDrag * 0.14 + spoilerWind * 0.18) * windAudible, 0, 0.48), t, 0.1);

    this.windAirSrc.playbackRate.setTargetAtTime((0.8 + 0.6 * speedFrac) * doppler, t, 0.06);
    this.windAirFilter.frequency.setTargetAtTime(clamp((480 + p.speed * 4.5 + p.spoilerPos * 420) * doppler, 300, 3800), t, 0.1);
    this.windAirGain.gain.setTargetAtTime(clamp((windQ * 0.16 + gearWind * 0.11 + spoilerWind * 0.2) * windAudible, 0, 0.42), t, 0.1);

    // buffet aerodinâmico: dentro de nuvem densa / spoiler aberto / trem baixado em alta / alto AoA
    const buffetAmt = clamp((p.inCloud * 0.35 + spoilerWind * 0.5 + aoaDrag * 0.55 + gearWind * 0.3) * (p.cockpit ? 0.26 : 0.14 * distAtt), 0, 0.35);
    this.buffetGain.gain.setTargetAtTime(buffetAmt, t, 0.12);
    this.buffetFilter.frequency.setTargetAtTime(160 + p.inCloud * 240 + p.spoilerPos * 180, t, 0.12);
  }

  /** Som mecânico: trem de pouso abrindo/fechando (bomba hidráulica + fluxo) */
  playGearMove(opening: boolean) {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    // motor hidráulico (zumbido crescente/decrescente de ~2.0s)
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(opening ? 130 : 175, t);
    o.frequency.linearRampToValueAtTime(opening ? 185 : 140, t + 2.0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.15);
    g.gain.setValueAtTime(0.07, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.3);
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 320;
    f.Q.value = 2;
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 2.35);

    // sopro das portas do trem
    this.noiseBurst(0.65, 0.11, 520, "bandpass", 0.05);
  }

  /** Tranca mecânica ("CLUNK") quando o trem trava em cima ou embaixo */
  playGearLock() {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.26, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
    this.noiseBurst(0.09, 0.14, 900, "bandpass");
  }

  /** Impacto das rodas + amortecedores + chiado curto de pneu na pista */
  playTouchdown(vyImpact: number, massKg: number) {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    const sev = clamp(-vyImpact / 6.5, 0.2, 1.3);
    const massFactor = clamp(Math.log10(Math.max(500, massKg)) / 4.8, 0.55, 1.15);

    // thump grave dos amortecedores comprimindo
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(88, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.45 * sev * massFactor, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.28);

    // golpe estrutural
    this.noiseBurst(0.24, 0.34 * sev, 240, "lowpass");

    // chiado curto dos pneus acelerando no asfalto (chirp)
    const sq = this.ctx.createBufferSource();
    sq.buffer = this.pinkBuf;
    const sf = this.ctx.createBiquadFilter();
    sf.type = "bandpass";
    sf.frequency.setValueAtTime(2150, t);
    sf.frequency.exponentialRampToValueAtTime(1600, t + 0.22);
    sf.Q.value = 5.5;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.001, t);
    sg.gain.linearRampToValueAtTime(0.18 * clamp(sev, 0.35, 1), t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    sq.connect(sf).connect(sg).connect(this.master);
    sq.start(t);
    sq.stop(t + 0.26);
  }

  /** Atuador do spoiler (freio aerodinâmico) */
  playSpoiler(opening: boolean) {
    if (this.disposed) return;
    this.noiseBurst(0.32, 0.14, opening ? 620 : 420, "bandpass");
  }

  blip(freq: number, dur: number, vol = 0.12, type: OscillatorType = "square") {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  noiseBurst(dur: number, vol: number, freq: number, type: BiquadFilterType, delay = 0) {
    if (this.disposed) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(64, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  boom(dist: number, size: number) {
    const vol = Math.min(0.95, size * 0.036) * clamp(1 - dist / 7000, 0.04, 1);
    this.noiseBurst(1.0 + size * 0.02, vol, Math.max(85, 320 - dist * 0.03), "lowpass", Math.min(6, dist / 343));
  }

  squelch() {
    this.noiseBurst(0.12, 0.1, 2000, "bandpass");
  }

  dispose() {
    this.disposed = true;
    try {
      void this.ctx.close();
    } catch {
      /* noop */
    }
  }
}
