import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { decompress } from 'fzstd';
import { createPoseDecoder } from '/decode-pose.mjs';
import { decodeReplayDeltaChunk } from '/viewer/core/session/replayDeltaCodec.js';
import { createObjectLibraryRegistry, getObjectLibraryMetadata, getObjectLibraryScene, cloneObjectLibraryPrototype } from '/viewer/core/map/objectLibrary.js';
import { collectJointBindings, collectSkinnedMeshes, prepareModelNodeSkinBindPose, applyModelNodePose, createModelNodePoseWorkspace, measureModelNodePose } from '/viewer/components/scene/player/playerModelNodes.js';

const report = await (await fetch('/report.json')).json();
const manifest = await (await fetch('/pose-manifest.json')).json();
const decode = createPoseDecoder({ ...T, decompress, decodeBase: decodeReplayDeltaChunk });
const grouped = new Map();
for (const sample of [...report.worst_poses, ...(report.preview_frames ?? [])]) {
  const chunk = manifest.chunks.find(c => sample.tick >= c.firstTick && sample.tick < c.firstTick + c.tickCount);
  if (!chunk) throw new Error('Missing sample chunk');
  const group = grouped.get(chunk.index) ?? []; group.push(sample); grouped.set(chunk.index, group);
}
let browserDecodedTicks = 0, browserChunkBytes = 0, maxReferenceDifference = 0;
for (const [index, samples] of grouped) {
  const compressed = new Uint8Array(await (await fetch(`/pose-chunks/${index}.zst`)).arrayBuffer());
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', compressed))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (digest !== manifest.chunks[index].compressedSha256) throw new Error('Compressed chunk checksum mismatch');
  const raw = decompress(compressed);
  if (raw.length !== manifest.chunks[index].rawBytes) throw new Error('Invalid chunk size');
  const decoded = decode(raw, manifest.settings);
  if (decoded.firstTick !== manifest.chunks[index].firstTick || decoded.ticks.length !== manifest.chunks[index].tickCount) throw new Error('Chunk coverage mismatch');
  browserDecodedTicks += decoded.ticks.length; browserChunkBytes += compressed.length;
  for (const sample of samples) {
    const actual = decoded.ticks[sample.tick - decoded.firstTick].players[sample.player].model_nodes;
    if (actual.length !== sample.decoded.length) throw new Error('Node count changed');
    actual.forEach((node, i) => node.forEach((value, c) => { maxReferenceDifference = Math.max(maxReferenceDifference, Math.abs(value - sample.decoded[i][c])); }));
    sample.decoded = actual;
  }
}
if (maxReferenceDifference > 1e-6) throw new Error('Browser/reference pose mismatch');
const gltf = await new GLTFLoader().loadAsync('/model.glb');
const registry = createObjectLibraryRegistry(getObjectLibraryMetadata(gltf.parser.json.extras), getObjectLibraryScene(gltf));
const entry = registry.byObjectTagPath.get(report.worst_poses[0].tag);
if (!entry) throw new Error('Missing model entry');
const views = ['source', 'decoded'].map(id => {
  const el = document.getElementById(id), renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); el.append(renderer.domElement);
  const scene = new T.Scene(); scene.background = new T.Color('#eeeeef');
  const camera = new T.PerspectiveCamera(38, 1, 0.01, 100); camera.position.set(1.1, 0.8, 1.5);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0.38, 0); controls.update();
  scene.add(new T.HemisphereLight(0xffffff, 0x5e6876, 2.3));
  const light = new T.DirectionalLight(0xffffff, 2.5); light.position.set(2, 4, 3); scene.add(light);
  const root = cloneObjectLibraryPrototype(entry); scene.add(root);
  root.traverse(o => { o.visible = true; if (o.isMesh) { o.frustumCulled = false; o.material = new T.MeshStandardMaterial({ color: 0x288471, roughness: 0.68, metalness: 0.15 }); } });
  const bindings = collectJointBindings(root, entry), meshes = collectSkinnedMeshes(root);
  if (!prepareModelNodeSkinBindPose(root, bindings, meshes)) throw new Error('Bind pose failed');
  const workspace = createModelNodePoseWorkspace(bindings);
  function resize() { const width = el.clientWidth, height = el.clientHeight; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(el); resize();
  return { renderer, scene, camera, controls, root, bindings, meshes, workspace };
});
const frame = document.getElementById('frame'), tick = document.getElementById('tick'), mode = document.getElementById('mode'), play = document.getElementById('play');
let playing = true, selected = 0;
const samples = () => mode.value === 'clip' && report.preview_frames?.length ? report.preview_frames : report.worst_poses;
function apply(sample) {
  const n = sample.original[0], base = new T.Vector3(n[0], n[2] - 0.3, -n[1]);
  for (let i = 0; i < 2; i++) {
    const v = views[i], nodes = i ? sample.decoded : sample.original;
    if (!applyModelNodePose(v.root, v.bindings, v.meshes, nodes, base, { workspace: v.workspace })) throw new Error('Pose application failed');
    v.diagnostic = measureModelNodePose(v.root, v.bindings, nodes);
  }
  tick.value = String(sample.tick);
}
function select(index) { const list = samples(); selected = index % list.length; frame.max = list.length - 1; frame.value = selected; apply(list[selected]); }
const vertex = new T.Vector3(), other = new T.Vector3();
let maxVertexError = 0, verticesChecked = 0, layoutMismatches = 0;
for (const sample of [...report.worst_poses, ...(report.preview_frames ?? [])]) {
  apply(sample);
  if (views[0].diagnostic.runtimeRotationLayout !== views[1].diagnostic.runtimeRotationLayout) layoutMismatches++;
  for (let mesh = 0; mesh < views[0].meshes.length; mesh++) {
    const a = views[0].meshes[mesh], b = views[1].meshes[mesh];
    for (let i = 0; i < a.geometry.attributes.position.count; i++) {
      a.getVertexPosition(i, vertex); a.localToWorld(vertex); b.getVertexPosition(i, other); b.localToWorld(other);
      maxVertexError = Math.max(maxVertexError, vertex.distanceTo(other)); verticesChecked++;
    }
  }
}
document.getElementById('status').textContent = `Max mesh error ${maxVertexError.toExponential(2)} units`;
const sync = source => { const target = views.find(v => v !== source); target.camera.position.copy(source.camera.position); target.controls.target.copy(source.controls.target); target.controls.update(); };
// Render controls independently; orbiting one view updates the other on pointer release.
views.forEach(v => v.renderer.domElement.addEventListener('pointerup', () => sync(v)));
play.onclick = () => { playing = !playing; play.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;'; play.title = playing ? 'Pause' : 'Play'; play.setAttribute('aria-label', play.title); };
frame.oninput = () => { playing = false; play.innerHTML = '&#9654;'; select(Number(frame.value)); };
mode.onchange = () => select(0);
select(0);
let last = performance.now();
function render(now) {
  if (playing && now - last >= 1000 / 120) { select(selected + Math.max(1, Math.floor((now - last) / (1000 / 120)))); last = now; }
  if (!playing) last = now;
  views.forEach(v => v.renderer.render(v.scene, v.camera)); requestAnimationFrame(render);
}
requestAnimationFrame(render);
window.poseLab = { ready: true, maxVertexError, verticesChecked, layoutMismatches, frames: samples().length,
  browserDecodedChunks: grouped.size, browserDecodedTicks, browserChunkBytes, maxReferenceDifference,
  select, pause() { playing = false; }, pixels() { return views.map(v => { const gl = v.renderer.getContext(), bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes); let colored = 0, checksum = 0; for (let i = 0; i < bytes.length; i += 4) { if (bytes[i + 1] > bytes[i] * 1.15 && bytes[i + 1] > bytes[i + 2] * 1.04) colored++; checksum = (checksum + bytes[i] + bytes[i + 1] * 3 + bytes[i + 2] * 7) >>> 0; } return { colored, checksum, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }; }); } };
