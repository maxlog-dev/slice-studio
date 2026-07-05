import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARC_L, FACES, R, SIDE_H, THETA, type FaceId } from './geometry';
import type { EditorManager } from './editor';

const SC = 1 / 100; // mm -> world units
const N = 40; // arc segments

// Each face mesh uses the SAME intrinsic (u right, v down, viewed from outside)
// frame as the editor canvas and the printed net, so texture orientation matches
// the folded paper model exactly.
function buildFaceGeometry(id: FaceId): THREE.BufferGeometry {
  const a1 = -THETA / 2;
  const a2 = THETA / 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const sinT = Math.sin(THETA);

  if (id === 'side1' || id === 'side2') {
    const corners: [number, number][] = [[0, 0], [R, 0], [R, SIDE_H], [0, SIDE_H]];
    for (const [u, v] of corners) {
      const rad = id === 'side1' ? u : R - u;
      const a = id === 'side1' ? a2 : a1;
      pos.push(rad * Math.cos(a) * SC, (SIDE_H - v) * SC, rad * Math.sin(a) * SC);
      uv.push(u / R, 1 - v / SIDE_H);
    }
    idx.push(0, 1, 2, 0, 2, 3);
  } else if (id === 'outer') {
    for (let i = 0; i <= N; i++) {
      const u = (ARC_L * i) / N;
      const a = a2 - u / R;
      for (const v of [0, SIDE_H]) {
        pos.push(R * Math.cos(a) * SC, (SIDE_H - v) * SC, R * Math.sin(a) * SC);
        uv.push(u / ARC_L, 1 - v / SIDE_H);
      }
    }
    for (let i = 0; i < N; i++) {
      const k = i * 2;
      idx.push(k, k + 2, k + 3, k, k + 3, k + 1);
    }
  } else {
    // top / bottom sectors: triangle fan from the apex
    const y = id === 'top' ? SIDE_H : 0;
    pos.push(0, y * SC, 0);
    uv.push(0, id === 'top' ? 0 : 1);
    for (let i = 0; i <= N; i++) {
      const phi = (THETA * i) / N;
      const a = a2 - phi;
      pos.push(R * Math.cos(a) * SC, y * SC, R * Math.sin(a) * SC);
      const t = Math.sin(phi) / sinT;
      uv.push(Math.cos(phi), id === 'top' ? t : 1 - t);
    }
    for (let i = 1; i <= N; i++) idx.push(0, i, i + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export default function Preview3D({ mgr }: { mgr: EditorManager }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1b21');

    // camera orbit start matches the design (r=3, th=-0.85, ph=1.12 around the target)
    const target = new THREE.Vector3(0.45, 0.24, 0);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
    const r0 = 3.0;
    const th = -0.85;
    const ph = 1.12;
    camera.position.set(
      target.x + r0 * Math.sin(ph) * Math.cos(th),
      target.y + r0 * Math.cos(ph),
      target.z + r0 * Math.sin(ph) * Math.sin(th),
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.3;
    controls.maxDistance = 7;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.55;
    controls.enablePan = false;

    const textures = new Map<FaceId, THREE.CanvasTexture>();
    const dirty = new Set<FaceId>(FACES.map((f) => f.id));

    for (const f of FACES) {
      const tex = new THREE.CanvasTexture(mgr.canvas(f.id).lowerCanvasEl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      textures.set(f.id, tex);
      const geo = buildFaceGeometry(f.id);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }),
      );
      scene.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 35),
        new THREE.LineBasicMaterial({ color: 0x3a3d47 }),
      );
      scene.add(edges);
    }

    // cake plate under the slice
    const plate = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 48),
      new THREE.MeshLambertMaterial({ color: 0x24262d }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0.45, -0.005, 0);
    scene.add(plate);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3c46, 0.95 * Math.PI));
    const dl = new THREE.DirectionalLight(0xffffff, 0.65 * Math.PI);
    dl.position.set(1.2, 2.2, 0.9);
    scene.add(dl);

    const unsubscribe = mgr.addRenderListener((id) => dirty.add(id));

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      for (const id of dirty) {
        const tex = textures.get(id);
        if (tex) tex.needsUpdate = true;
      }
      dirty.clear();
      renderer.render(scene, camera);
    };
    loop();

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsubscribe();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const m = o.material as THREE.Material;
          m.dispose();
        }
      });
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [mgr]);

  return <div className="preview3d" ref={holder} />;
}
