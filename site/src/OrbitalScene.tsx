import { useEffect, useRef } from 'react';
import * as THREE from 'three';

function ring(radius: number, color: THREE.ColorRepresentation, opacity: number, rotation: [number, number, number]) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 220; i += 1) {
    const angle = (i / 220) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
  });
  const line = new THREE.Line(geometry, material);
  line.rotation.set(...rotation);
  return line;
}

export default function OrbitalScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0.3, 0.2, 7.9);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    root.position.set(1.25, -0.05, 0);
    scene.add(root);

    const monolith = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 3.25, 0.28, 1, 10, 1),
      new THREE.MeshStandardMaterial({
        color: 0xe4ebf2,
        metalness: 0.94,
        roughness: 0.3,
        emissive: 0x1c222b,
        emissiveIntensity: 0.22,
      }),
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.37, 2.8, 0.292),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.055 }),
    );
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 3.34, 0.305),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, wireframe: true }),
    );
    const seamMaterial = new THREE.MeshBasicMaterial({ color: 0x11151f, transparent: true, opacity: 0.75 });
    [-1.1, -0.42, 0.31, 0.96].forEach((y) => {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.012, 0.315), seamMaterial);
      seam.position.y = y;
      monolith.add(seam);
    });
    const amber = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.018, 0.322),
      new THREE.MeshBasicMaterial({ color: 0xc85a3f, transparent: true, opacity: 0.92 }),
    );
    amber.position.set(0.02, 0.55, 0);
    monolith.add(body, core, edge, amber);
    monolith.rotation.set(-0.13, -0.37, 0.05);
    root.add(monolith);

    const ringA = ring(2.25, 0xdfe6ee, 0.32, [1.26, 0.17, 0.22]);
    const ringB = ring(2.95, 0x54d6a4, 0.13, [1.08, -0.36, -0.5]);
    const ringC = ring(3.55, 0xc85a3f, 0.11, [1.45, 0.2, 0.76]);
    root.add(ringA, ringB, ringC);

    const nodeGeometry = new THREE.SphereGeometry(0.033, 12, 12);
    const whiteNode = new THREE.MeshBasicMaterial({ color: 0xf0f4f8, transparent: true, opacity: 0.86 });
    const amberNode = new THREE.MeshBasicMaterial({ color: 0xc85a3f, transparent: true, opacity: 0.9 });
    const nodes = Array.from({ length: 22 }).map((_, index) => {
      const node = new THREE.Mesh(nodeGeometry, index % 8 === 0 ? amberNode : whiteNode);
      const radius = 2.22 + (index % 3) * 0.66;
      const angle = (index / 22) * Math.PI * 2;
      node.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.27, Math.sin(angle) * 0.42);
      root.add(node);
      return { node, radius, angle, speed: 0.15 + (index % 5) * 0.028 };
    });

    const starCount = 720;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const p = i * 3;
      starPositions[p] = (Math.random() - 0.5) * 24;
      starPositions[p + 1] = (Math.random() - 0.5) * 12;
      starPositions[p + 2] = -Math.random() * 18 - 2;
      const tint = 0.58 + Math.random() * 0.42;
      starColors[p] = tint;
      starColors[p + 1] = tint * 0.95;
      starColors[p + 2] = tint * 0.88;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 0.024,
        vertexColors: true,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(stars);

    scene.add(new THREE.AmbientLight(0x9aa6b4, 0.48));
    const key = new THREE.DirectionalLight(0xffffff, 2.35);
    key.position.set(4.5, 3.1, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0xc85a3f, 2.4, 11);
    rim.position.set(-2.3, -0.7, 2.4);
    scene.add(rim);

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const startedAt = performance.now();
    let frame = 0;
    const animate = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      root.position.y = Math.sin(elapsed * 0.28) * 0.08;
      if (!reducedMotion) {
        monolith.rotation.y = -0.37 + Math.sin(elapsed * 0.22) * 0.15;
        monolith.rotation.x = -0.13 + Math.sin(elapsed * 0.18) * 0.035;
        ringA.rotation.z = elapsed * 0.11;
        ringB.rotation.z = -elapsed * 0.075;
        ringC.rotation.z = elapsed * 0.048;
        stars.rotation.y = elapsed * 0.006;
        nodes.forEach(({ node, radius, angle, speed }, index) => {
          const next = angle + elapsed * speed;
          node.position.x = Math.cos(next) * radius;
          node.position.y = Math.sin(next) * radius * (0.24 + (index % 2) * 0.035);
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
      [whiteNode, amberNode, seamMaterial].forEach((material) => material.dispose());
      [body, core, edge, amber].forEach((mesh) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      [ringA, ringB, ringC].forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="orbital-scene" aria-hidden="true" />;
}
