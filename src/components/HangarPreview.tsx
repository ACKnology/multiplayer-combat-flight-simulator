"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { byId } from "@/sim/aircraft";
import { buildAircraft } from "@/sim/models";

export default function HangarPreview({ aircraftId }: { aircraftId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.65;
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.1, 500);
    const spec = byId(aircraftId);
    const model = buildAircraft(spec);
    model.gear.visible = false;
    scene.add(model.group);

    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a3324, 1.1));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
    key.position.set(12, 18, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5ac8ff, 1.4);
    rim.position.set(-14, 6, -10);
    scene.add(rim);

    // pedestal
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(14 * spec.scale, 0.12, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -4 * spec.scale;
    scene.add(ring);

    let raf = 0;
    let ang = 0.6;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      ang += 0.004;
      const r = 30 * spec.scale;
      camera.position.set(Math.cos(ang) * r, 7 * spec.scale, Math.sin(ang) * r);
      camera.lookAt(0, 0, 0);
      model.group.rotation.z = Math.sin(ang * 2) * 0.06;
      model.group.position.y = Math.sin(ang * 1.6) * 0.6;
      if (model.prop) model.prop.rotation.z += 0.4;
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [aircraftId]);

  return <div ref={ref} className="h-full w-full" />;
}