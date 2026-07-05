import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SIDE_H, type FaceId, type Geometry } from './geometry';
import type { EditorManager } from './editor';

const SC = 1 / 100; // mm -> world units

// Each face mesh uses the SAME intrinsic (u right, v down, viewed from outside)
// frame as the editor canvas and the printed net, so texture orientation matches
// the folded paper model exactly. Flat-back wedge: every face is a polygon.
function buildFaceGeometry(geo: Geometry, id: FaceId): THREE.BufferGeometry {
  const { R, theta, chord, topH } = geo;
  const H = SIDE_H;
  const half = theta / 2;
  const cx = R * Math.cos(half); // back-panel x
  const cz = R * Math.sin(half); // back-panel half-width in z
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  if (id === 'side1' || id === 'side2') {
    const a = id === 'side1' ? half : -half;
    const corners: [number, number][] = [[0, 0], [R, 0], [R, H], [0, H]];
    for (const [u, v] of corners) {
      const rad = id === 'side1' ? u : R - u;
      pos.push(rad * Math.cos(a) * SC, (H - v) * SC, rad * Math.sin(a) * SC);
      uv.push(u / R, 1 - v / H);
    }
    idx.push(0, 1, 2, 0, 2, 3);
  } else if (id === 'outer') {
    // flat back: u=0 at the side1 corner, u=chord at the side2 corner
    const corners: [number, number][] = [[0, 0], [chord, 0], [chord, H], [0, H]];
    for (const [u, v] of corners) {
      pos.push(cx * SC, (H - v) * SC, (cz - (2 * cz * u) / chord) * SC);
      uv.push(u / chord, 1 - v / H);
    }
    idx.push(0, 1, 2, 0, 2, 3);
  } else {
    // top / bottom triangles
    const y = (id === 'top' ? H : 0) * SC;
    const apexV = id === 'top' ? topH : 0;
    // intrinsic (u,v) -> uv; 3D corners: apex, side1 corner, side2 corner
    const tri: { p: [number, number, number]; t: [number, number] }[] = [
      { p: [0, y, 0], t: [0, 1 - apexV / topH] },
      { p: [cx * SC, y, cz * SC], t: [1, 1 - (id === 'top' ? topH : 0) / topH] },
      { p: [cx * SC, y, -cz * SC], t: [Math.cos(theta), 1 - (id === 'top' ? 0 : topH) / topH] },
    ];
    for (const { p, t } of tri) {
      pos.push(...p);
      uv.push(...t);
    }
    idx.push(0, 1, 2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export default function Preview3D({ mgr, slices }: { mgr: EditorManager; slices: number }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const geo = mgr.geo;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1b21');

    // camera orbit start matches the design (r, th=-0.85, ph=1.12 around the target)
    const size = geo.R * SC;
    const target = new THREE.Vector3(0.45 * size, 0.5 * SIDE_H * SC, 0);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
    const r0 = 3.0 * size;
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
    controls.minDistance = 1.3 * size;
    controls.maxDistance = 7 * size;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.55;
    controls.enablePan = false;

    const textures = new Map<FaceId, THREE.CanvasTexture>();
    const dirty = new Set<FaceId>(geo.faces.map((f) => f.id));

    for (const f of geo.faces) {
      const tex = new THREE.CanvasTexture(mgr.canvas(f.id).lowerCanvasEl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      textures.set(f.id, tex);
      const g = buildFaceGeometry(geo, f.id);
      const mesh = new THREE.Mesh(
        g,
        new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }),
      );
      scene.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(g, 35),
        new THREE.LineBasicMaterial({ color: 0x3a3d47 }),
      );
      scene.add(edges);
    }

    // cake plate under the slice
    const plate = new THREE.Mesh(
      new THREE.CircleGeometry(1.4 * size, 48),
      new THREE.MeshLambertMaterial({ color: 0x24262d }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0.45 * size, -0.005, 0);
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
  }, [mgr, slices]);

  return <div className="preview3d" ref={holder} />;
}
