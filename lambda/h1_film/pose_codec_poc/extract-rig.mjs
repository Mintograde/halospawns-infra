import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node extract-rig.mjs INPUT.glb OUTPUT.json');
const bytes = await readFile(input);
if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2
    || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) {
  throw new Error('Invalid GLB');
}
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const binaryStart = 20 + bytes.readUInt32LE(12) + 8;
function accessor(index) {
  const a = gltf.accessors[index];
  if (a.sparse || a.normalized) throw new Error('Unsupported accessor encoding');
  const view = gltf.bufferViews[a.bufferView];
  const arity = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const [width, read] = { 5121: [1, 'readUInt8'], 5123: [2, 'readUInt16LE'], 5126: [4, 'readFloatLE'] }[a.componentType] ?? [];
  if (!width || !arity || view.buffer !== 0) throw new Error('Unsupported accessor');
  const stride = view.byteStride ?? width * arity;
  const start = binaryStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: arity }, (_, c) => bytes[read](start + i * stride + c * width)));
}
const rigs = new Map();
for (const node of gltf.nodes ?? []) {
  const e = node.extras;
  const skin = e?.halo_model_skin;
  if (!skin || e.object_kind !== 'biped' || e.model_role !== 'world') continue;
  if (skin.schema !== 'halospawns.model_skin.v1' || skin.joint_order !== 'halo_model_node_index') {
    throw new Error('Unsupported skin contract');
  }
  const rig = {
    tag: e.object_tag_path,
    parents: skin.nodes.map((n, i) => n.parent_index === i ? -1 : (n.parent_index ?? -1)),
    names: skin.nodes.map(n => n.name),
    source_glb_sha256: createHash('sha256').update(bytes).digest('hex'),
    model_path: e.object_model_path
  };
  const radii = skin.nodes.map(() => 0);
  let vertexCount = 0, weightSumMax = 0;
  const inverseBinds = accessor(skin.inverse_bind_matrices);
  for (const primitive of gltf.meshes[node.mesh]?.primitives ?? []) {
    const positions = accessor(primitive.attributes.POSITION);
    const joints = accessor(primitive.attributes.JOINTS_0);
    const weights = accessor(primitive.attributes.WEIGHTS_0);
    vertexCount += positions.length;
    for (let i = 0; i < positions.length; i++) {
      weightSumMax = Math.max(weightSumMax, weights[i].reduce((a, b) => a + b, 0));
      for (let influence = 0; influence < 4; influence++) {
        if (weights[i][influence] <= 0) continue;
        const bone = joints[i][influence], m = inverseBinds[bone], p = positions[i];
        const local = [0, 1, 2].map(c => m[c] * p[0] + m[4 + c] * p[1] + m[8 + c] * p[2] + m[12 + c]);
        radii[bone] = Math.max(radii[bone], Math.hypot(...local));
      }
    }
  }
  rig.geometry_validation = { vertex_count: vertexCount, maximum_weight_sum: weightSumMax,
    node_local_vertex_radii: radii, maximum_node_local_vertex_radius: Math.max(...radii),
    maximum_marker_radius: Math.max(0, ...skin.markers.flatMap(m => m.instances.map(i => Math.hypot(...i.translation)))) };
  if (rigs.has(rig.tag) && JSON.stringify(rigs.get(rig.tag)) !== JSON.stringify(rig)) {
    throw new Error(`Conflicting rig ${rig.tag}`);
  }
  rigs.set(rig.tag, rig);
}
if (!rigs.size) throw new Error('No world biped rigs');
await writeFile(output, JSON.stringify([...rigs.values()], null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ input, output, rigs: rigs.size }));
