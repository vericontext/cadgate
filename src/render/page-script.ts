/// <reference lib="dom" />
/**
 * Three.js scene running inside Puppeteer-controlled Chromium.
 * Bundled with `bun build --target=browser --format=iife` and injected via
 * page.addScriptTag in the Renderer.
 *
 * Exposes window.cadgateRender({ vertProperties, triVerts, hotspots, view })
 * which positions the camera, renders, and returns the canvas as a data URL.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  Box3,
} from 'three';

interface RenderRequest {
  vertProperties: number[];
  triVerts: number[];
  hotspots: Array<{ point: [number, number, number]; thicknessMm: number }>;
  view: 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';
}

const VIEW_TO_DIRECTION: Record<RenderRequest['view'], [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

const VIEW_TO_UP: Record<RenderRequest['view'], [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, 1],
  top: [0, 1, 0],
  bottom: [0, 1, 0],
  left: [0, 0, 1],
  right: [0, 0, 1],
};

const CANVAS_SIZE = 1024;

let cachedRenderer: WebGLRenderer | null = null;
function getRenderer(): WebGLRenderer {
  if (!cachedRenderer) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    document.body.appendChild(canvas);
    cachedRenderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    cachedRenderer.setSize(CANVAS_SIZE, CANVAS_SIZE, false);
    cachedRenderer.setClearColor(0xffffff, 1);
  }
  return cachedRenderer;
}

function renderOne(req: RenderRequest): string {
  const renderer = getRenderer();
  const scene = new Scene();

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(req.vertProperties), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(req.triVerts), 1));
  geometry.computeVertexNormals();

  const material = new MeshLambertMaterial({ color: 0x9aa6b6, side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  const bbox = new Box3().setFromObject(mesh);
  const center = bbox.getCenter(new Vector3());
  const size = bbox.getSize(new Vector3());
  const diagonal = size.length();
  const halfExtent = diagonal * 0.55; // a touch of padding

  const dir = new Vector3(...VIEW_TO_DIRECTION[req.view]).normalize();
  const camera = new OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, -diagonal * 4, diagonal * 4);
  camera.position.copy(center).addScaledVector(dir, -diagonal * 2);
  camera.up.set(...VIEW_TO_UP[req.view]);
  camera.lookAt(center);

  const ambient = new AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  const key = new DirectionalLight(0xffffff, 0.85);
  key.position.copy(center).add(new Vector3(diagonal, diagonal, diagonal));
  scene.add(key);

  if (req.hotspots.length > 0) {
    const sphereGeom = new SphereGeometry(diagonal * 0.012, 12, 8);
    const sphereMat = new MeshBasicMaterial({ color: 0xff3838 });
    for (const h of req.hotspots) {
      const dot = new Mesh(sphereGeom, sphereMat);
      dot.position.set(h.point[0], h.point[1], h.point[2]);
      scene.add(dot);
    }
  }

  renderer.render(scene, camera);

  geometry.dispose();
  material.dispose();

  return renderer.domElement.toDataURL('image/png');
}

declare global {
  interface Window {
    cadgateRender: (req: RenderRequest) => string;
  }
}

window.cadgateRender = renderOne;
