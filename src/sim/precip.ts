import * as THREE from "three";

/** chuva (riscos alinhados ao fluxo relativo) e neve (partículas) ao redor da câmera */
export class Precip {
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rp = new Float32Array(3200 * 3);
  private rv: Float32Array;
  private sp = new Float32Array(2200 * 3);
  private N = 3200;
  private S = 2200;
  private box = 110;
  mode: "none" | "rain" | "snow" = "none";
  intensity = 0;
  private wind = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const half = this.box / 2;
    for (let i = 0; i < this.N * 3; i++) this.rp[i] = (Math.random() - 0.5) * this.box;
    for (let i = 0; i < this.S * 3; i++) this.sp[i] = (Math.random() - 0.5) * this.box;
    this.rv = new Float32Array(this.N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.rv, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb4c7da, transparent: true, opacity: 0.42, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.S * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const cv = document.createElement("canvas");
    cv.width = cv.height = 32;
    const c = cv.getContext("2d")!;
    const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gr;
    c.fillRect(0, 0, 32, 32);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false, sizeAttenuation: true }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    scene.add(this.rain, this.snow);
    void half;
  }

  set(mode: "none" | "rain" | "snow", intensity: number, wind: THREE.Vector3) {
    this.mode = intensity < 0.03 ? "none" : mode;
    this.intensity = intensity;
    this.wind.copy(wind);
    this.rain.visible = this.mode === "rain";
    this.snow.visible = this.mode === "snow";
  }

  update(dt: number, cam: THREE.Vector3, camVel: THREE.Vector3) {
    if (this.mode === "none") return;
    const half = this.box / 2, box = this.box;
    if (this.mode === "rain") {
      const n = Math.max(200, Math.floor(this.N * this.intensity));
      const fx = this.wind.x * 0.6, fz = this.wind.z * 0.6;
      const rx = fx - camVel.x, ry = -24 - camVel.y, rz = fz - camVel.z;
      const rl = Math.hypot(rx, ry, rz) || 1;
      const len = Math.min(18, Math.max(0.7, rl * 0.045));
      const dx = (rx / rl) * len, dy = (ry / rl) * len, dz = (rz / rl) * len;
      for (let i = 0; i < n; i++) {
        let x = this.rp[i * 3] + fx * dt, y = this.rp[i * 3 + 1] - 24 * dt, z = this.rp[i * 3 + 2] + fz * dt;
        // posições absolutas no mundo, embrulhadas em torno da câmera
        let ax = x - cam.x, ay = y - cam.y, az = z - cam.z;
        while (ax > half) { ax -= box; x -= box; }
        while (ax < -half) { ax += box; x += box; }
        while (ay > half) { ay -= box; y -= box; }
        while (ay < -half) { ay += box; y += box; }
        while (az > half) { az -= box; z -= box; }
        while (az < -half) { az += box; z += box; }
        this.rp[i * 3] = x;
        this.rp[i * 3 + 1] = y;
        this.rp[i * 3 + 2] = z;
        const o = i * 6;
        this.rv[o] = x; this.rv[o + 1] = y; this.rv[o + 2] = z;
        this.rv[o + 3] = x - dx; this.rv[o + 4] = y - dy; this.rv[o + 5] = z - dz;
      }
      const g = this.rain.geometry;
      g.setDrawRange(0, n * 2);
      (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.18 + 0.3 * this.intensity;
    } else {
      const n = Math.max(200, Math.floor(this.S * this.intensity));
      const arr = (this.snow.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < n; i++) {
        let x = this.sp[i * 3] + (this.wind.x * 0.5 + Math.sin(i + cam.x * 0.01) * 0.6) * dt;
        let y = this.sp[i * 3 + 1] - 2.2 * dt;
        let z = this.sp[i * 3 + 2] + (this.wind.z * 0.5 + Math.cos(i * 1.7) * 0.6) * dt;
        let ax = x - cam.x, ay = y - cam.y, az = z - cam.z;
        while (ax > half) { ax -= box; x -= box; }
        while (ax < -half) { ax += box; x += box; }
        while (ay > half) { ay -= box; y -= box; }
        while (ay < -half) { ay += box; y += box; }
        while (az > half) { az -= box; z -= box; }
        while (az < -half) { az += box; z += box; }
        this.sp[i * 3] = x; this.sp[i * 3 + 1] = y; this.sp[i * 3 + 2] = z;
        arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
      }
      this.snow.geometry.setDrawRange(0, n);
      (this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}