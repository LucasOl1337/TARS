import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface TarsScene3DProps {
  collapsed?: boolean;
}

function makeRing(radius: number, color: THREE.ColorRepresentation, opacity: number, rotation: [number, number, number]) {
  const points: THREE.Vector3[] = [];
  const segments = 180;
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Line(geometry, material);
  ring.rotation.set(...rotation);
  return ring;
}

export default function TarsScene3D({ collapsed = false }: TarsScene3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080a0e, 0.045);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.set(0, 0.35, 8.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const monolith = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 2.72, 0.24, 1, 8, 1),
      new THREE.MeshStandardMaterial({
        color: 0xdfe6ee,
        metalness: 0.92,
        roughness: 0.28,
        emissive: 0x2c333d,
        emissiveIntensity: 0.28,
      }),
    );
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 2.78, 0.255),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.055, wireframe: true }),
    );
    const seamMaterial = new THREE.MeshBasicMaterial({ color: 0x161b22, transparent: true, opacity: 0.72 });
    [-0.66, 0, 0.66].forEach((y) => {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.59, 0.012, 0.27), seamMaterial);
      seam.position.y = y;
      monolith.add(seam);
    });
    monolith.add(body, edge);
    monolith.rotation.set(-0.12, -0.36, 0.04);
    root.add(monolith);

    const ringA = makeRing(2.02, 0xdfe6ee, 0.3, [1.28, 0.2, 0.18]);
    const ringB = makeRing(2.62, 0x54d6a4, 0.12, [1.06, -0.38, -0.55]);
    const ringC = makeRing(3.22, 0xe0a846, 0.08, [1.48, 0.16, 0.74]);
    root.add(ringA, ringB, ringC);

    const nodeGeometry = new THREE.SphereGeometry(0.035, 12, 12);
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xeef2f7, transparent: true, opacity: 0.85 });
    const nodes = Array.from({ length: 18 }).map((_, i) => {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      const r = 2.02 + (i % 3) * 0.58;
      const a = (i / 18) * Math.PI * 2;
      node.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.28, Math.sin(a) * 0.38);
      root.add(node);
      return { node, r, a, speed: 0.18 + (i % 4) * 0.035 };
    });

    const starCount = 620;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const i3 = i * 3;
      starPositions[i3] = (Math.random() - 0.5) * 24;
      starPositions[i3 + 1] = (Math.random() - 0.5) * 12;
      starPositions[i3 + 2] = -Math.random() * 18 - 2;
      const tint = 0.62 + Math.random() * 0.38;
      starColors[i3] = tint;
      starColors[i3 + 1] = tint * (0.92 + Math.random() * 0.08);
      starColors[i3 + 2] = tint * (0.82 + Math.random() * 0.16);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 0.025,
        vertexColors: true,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(stars);

    scene.add(new THREE.AmbientLight(0x9aa6b4, 0.48));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 3, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x54d6a4, 3.2, 12);
    rim.position.set(-2.8, -0.8, 2.4);
    scene.add(rim);

    let frame = 0;
    const clock = new THREE.Clock();

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const sideOffset = collapsed ? -0.65 : -1.1;
      root.position.x = THREE.MathUtils.lerp(root.position.x, sideOffset, 0.02);
      root.position.y = Math.sin(elapsed * 0.28) * 0.08;

      if (!reducedMotion) {
        monolith.rotation.y = -0.36 + Math.sin(elapsed * 0.22) * 0.16;
        monolith.rotation.x = -0.12 + Math.sin(elapsed * 0.18) * 0.035;
        ringA.rotation.z = elapsed * 0.12;
        ringB.rotation.z = -elapsed * 0.08;
        ringC.rotation.z = elapsed * 0.05;
        stars.rotation.y = elapsed * 0.006;
        nodes.forEach(({ node, r, a, speed }, index) => {
          const next = a + elapsed * speed;
          node.position.x = Math.cos(next) * r;
          node.position.y = Math.sin(next) * r * (0.26 + (index % 2) * 0.04);
          node.position.z = Math.sin(next) * 0.42;
        });
      }

      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      starGeometry.dispose();
      nodeGeometry.dispose();
      body.geometry.dispose();
      edge.geometry.dispose();
      (body.material as THREE.Material).dispose();
      (edge.material as THREE.Material).dispose();
      seamMaterial.dispose();
      [ringA, ringB, ringC].forEach((ring) => {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
      });
      host.removeChild(renderer.domElement);
    };
  }, [collapsed]);

  return (
    <div
      ref={hostRef}
      className="tars-scene3d fixed inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
