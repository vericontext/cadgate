import { BufferAttribute, BufferGeometry, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { ParsedMesh } from './manifold.ts';
import type { Vec3 } from '../core/types.ts';

export interface MinWallHotspot {
  point: Vec3;
  thicknessMm: number;
}

export interface MinWallResult {
  /** Thinnest wall found, in mm. -1 if the mesh is not analyzable (non-watertight, degenerate). */
  minWallMm: number;
  /** Worst N triangles, sorted ascending by thickness. */
  hotspots: MinWallHotspot[];
  /** Number of triangles considered (after dropping degenerate ones). */
  trianglesAnalyzed: number;
}

const EPSILON = 1e-4;          // Step inward to avoid self-hit
const DEGENERATE_AREA = 1e-8;  // Skip triangles with area < this (mm²)
const DEFAULT_HOTSPOT_COUNT = 5;

/**
 * Compute minimum wall thickness via inverted-normal ray-casting on a BVH:
 * for each triangle, cast a ray from its centroid (offset inward) along the
 * inward normal; the next-surface hit distance is the local wall thickness.
 *
 * Caller must guarantee the mesh is watertight; for non-watertight inputs we
 * return minWallMm = -1.
 */
export function computeMinWall(
  mesh: ParsedMesh,
  options: { isWatertight: boolean; hotspotCount?: number } = { isWatertight: true },
): MinWallResult {
  if (!options.isWatertight) {
    return { minWallMm: -1, hotspots: [], trianglesAnalyzed: 0 };
  }

  const N = options.hotspotCount ?? DEFAULT_HOTSPOT_COUNT;
  const verts = mesh.vertProperties;
  const tris = mesh.triVerts;

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(verts, 3));
  geom.setIndex(new BufferAttribute(tris, 1));
  const bvh = new MeshBVH(geom);

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const normal = new Vector3();
  const centroid = new Vector3();
  const origin = new Vector3();
  const dir = new Vector3();
  const ray = new Ray();

  let minThickness = Infinity;
  const hotspots: MinWallHotspot[] = []; // sorted ascending; bounded length N

  let analyzed = 0;
  const triCount = tris.length / 3;
  for (let t = 0; t < triCount; t++) {
    const ia = tris[t * 3]! * 3;
    const ib = tris[t * 3 + 1]! * 3;
    const ic = tris[t * 3 + 2]! * 3;

    a.set(verts[ia]!, verts[ia + 1]!, verts[ia + 2]!);
    b.set(verts[ib]!, verts[ib + 1]!, verts[ib + 2]!);
    c.set(verts[ic]!, verts[ic + 1]!, verts[ic + 2]!);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    const area = normal.length() * 0.5;
    if (area < DEGENERATE_AREA) continue;
    normal.divideScalar(area * 2); // normalize (length / 2 * 2 == length)

    centroid.copy(a).add(b).add(c).divideScalar(3);
    origin.copy(centroid).addScaledVector(normal, -EPSILON);
    dir.copy(normal).multiplyScalar(-1);

    ray.set(origin, dir);
    const hit = bvh.raycastFirst(ray, 2 /* DoubleSide */);
    if (!hit) continue;

    const thickness = hit.distance + EPSILON;
    analyzed++;

    if (thickness < minThickness) minThickness = thickness;

    // Maintain bounded sorted hotspots (small N, linear insert is fine).
    if (hotspots.length < N || thickness < hotspots[hotspots.length - 1]!.thicknessMm) {
      const entry: MinWallHotspot = {
        thicknessMm: thickness,
        point: [centroid.x, centroid.y, centroid.z],
      };
      let i = hotspots.findIndex((h) => h.thicknessMm > thickness);
      if (i === -1) i = hotspots.length;
      hotspots.splice(i, 0, entry);
      if (hotspots.length > N) hotspots.length = N;
    }
  }

  return {
    minWallMm: analyzed > 0 ? minThickness : -1,
    hotspots,
    trianglesAnalyzed: analyzed,
  };
}
