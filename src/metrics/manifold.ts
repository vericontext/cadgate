import Module from 'manifold-3d';
import wasmAssetPath from 'manifold-3d/manifold.wasm' with { type: 'file' };
import type { Metrics } from '../core/types.ts';
import type { RunErrorKind } from '../drivers/types.ts';
import { computeMinWall } from './min-wall.ts';

type ManifoldToplevel = Awaited<ReturnType<typeof Module>>;
type ManifoldInstance = InstanceType<ManifoldToplevel['Manifold']>;

export interface ParsedMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}

export type AnalyzeResult =
  | {
      ok: true;
      metrics: Metrics;
      mesh: ParsedMesh;
      manifold: ManifoldInstance;
      dispose: () => void;
    }
  | { ok: false; error: { kind: RunErrorKind; message: string } };

let cached: Promise<ManifoldToplevel> | null = null;

function getManifold(): Promise<ManifoldToplevel> {
  if (!cached) {
    cached = (async () => {
      const wasmBinary = await Bun.file(wasmAssetPath).arrayBuffer();
      // Emscripten's Module factory accepts wasmBinary; the TS declaration
      // omits it. Cast keeps both dev and bun build --compile paths working.
      const wasm = await (Module as unknown as (config: {
        wasmBinary: ArrayBuffer;
      }) => Promise<ManifoldToplevel>)({ wasmBinary });
      wasm.setup();
      return wasm;
    })();
  }
  return cached;
}

const QUANT = 1e5; // 1e-5 mm precision

export function parseBinarySTL(buffer: ArrayBuffer): ParsedMesh {
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) {
    throw new Error(`STL too small: ${buffer.byteLength} bytes`);
  }
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (buffer.byteLength < expectedSize) {
    throw new Error(`STL truncated: expected ${expectedSize} bytes, got ${buffer.byteLength}`);
  }

  const verts: number[] = [];
  const tris = new Uint32Array(triCount * 3);
  const index = new Map<string, number>();

  let off = 84;
  for (let t = 0; t < triCount; t++) {
    off += 12; // skip normal (3 floats)
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(off, true);
      const y = view.getFloat32(off + 4, true);
      const z = view.getFloat32(off + 8, true);
      off += 12;

      const key = `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
      let idx = index.get(key);
      if (idx === undefined) {
        idx = verts.length / 3;
        index.set(key, idx);
        verts.push(x, y, z);
      }
      tris[t * 3 + v] = idx;
    }
    off += 2; // skip attribute byte count
  }

  return {
    vertProperties: new Float32Array(verts),
    triVerts: tris,
  };
}

const STL_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function fail(kind: RunErrorKind, message: string): AnalyzeResult {
  return { ok: false, error: { kind, message } };
}

export async function analyzeStl(stlPath: string): Promise<AnalyzeResult> {
  const file = Bun.file(stlPath);
  const size = file.size;
  if (size === 0) return fail('mesh_invalid', `STL is empty: ${stlPath}`);
  if (size > STL_MAX_BYTES) {
    return fail(
      'mesh_invalid',
      `STL exceeds ${STL_MAX_BYTES} byte limit (${size} bytes): ${stlPath}`,
    );
  }

  const buffer = await file.arrayBuffer();
  let parsed: ParsedMesh;
  try {
    parsed = parseBinarySTL(buffer);
  } catch (err) {
    return fail('mesh_invalid', err instanceof Error ? err.message : String(err));
  }

  const wasm = await getManifold();
  const meshObj = new wasm.Mesh({
    numProp: 3,
    vertProperties: parsed.vertProperties,
    triVerts: parsed.triVerts,
  });
  const manifold = new wasm.Manifold(meshObj);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    manifold.delete();
  };

  try {
    const triCount = manifold.numTri();
    const status = manifold.status();
    const box = manifold.boundingBox();
    const isWatertight = triCount > 0 && status === 'NoError';
    const minWall = computeMinWall(parsed, { isWatertight });
    const metrics: Metrics = {
      volume: manifold.volume(),
      surfaceArea: manifold.surfaceArea(),
      isWatertight,
      bbox: {
        min: [box.min[0], box.min[1], box.min[2]],
        max: [box.max[0], box.max[1], box.max[2]],
      },
      triCount,
      minWallMm: minWall.minWallMm,
      minWallHotspots: minWall.hotspots,
    };
    return { ok: true, metrics, mesh: parsed, manifold, dispose };
  } catch (err) {
    dispose();
    return fail('mesh_invalid', err instanceof Error ? err.message : String(err));
  }
}
