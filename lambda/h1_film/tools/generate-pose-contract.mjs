// Append-only generation of the shared revision-4 contract. Released documents are inputs only.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../../..');
const directories = [resolve(root, 'lambda/replay_parser/contracts/replays'), resolve(root, '../halospawns-api/contracts/replays'), resolve(root, '../halospawns-svelte/packages/viewer/src/lib/core/session/contracts')];
const read = name => JSON.parse(readFileSync(resolve(directories[0], name), 'utf8'));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const projection = read('frontend-default.v3.projection.json');
projection.profile_revision = projection.generated_fields.artifact.profile_revision = 4;
projection.limits.players_per_tick = 4;
const projectionHash = hash(projection);
const schema = read('halospawns.viewerReplay.v1.frontend-default.v3.schema.json');
schema.title = 'Halospawns Viewer Replay V1 - Frontend Default Revision 4';
schema.$defs.artifact.properties.profile_revision.const = 4;
schema.$defs.artifact.properties.projection_sha256.const = projectionHash;
schema.$defs.tick.properties.players.maxItems = 4;
const manifest = read('halospawns.viewerReplayDelta.v1.frontend-default.v3.manifest.schema.json');
manifest.$id = manifest.properties.format.const = 'halospawns.viewerReplayDelta.v2';
manifest.title = 'HaloSpawns Viewer Replay Delta Container Manifest v2 - Frontend Default Revision 4';
manifest.$defs.sourceContract.properties.profile_revision.const = 4;
manifest.$defs.sourceContract.properties.projection_sha256.const = projectionHash;
manifest.$defs.chunk.required = manifest.$defs.chunk.required.map(key => key === 'tickSha256' ? 'rawSha256' : key);
manifest.$defs.chunk.properties.rawSha256 = manifest.$defs.chunk.properties.tickSha256;
delete manifest.$defs.chunk.properties.tickSha256;
manifest.$defs.chunk.properties.rawBytes.maximum = 64 * 1024 * 1024;
const encoding = read('viewer-delta.v1.encoding.json');
encoding.format = manifest.$id;
encoding.container.magic_ascii = 'HSRDC002';
encoding.container.version = 2;
encoding.container.manifest_compression.level = 6;
encoding.chunk = {
  magic_ascii: 'PC01', version: 1, byte_order: 'little_endian',
  compression: { name: 'zstd', level: 6, checksum: true, independent_frames: true },
  header: ['magic:4', 'base_raw_bytes:uint32', 'base_compressed_bytes:uint32', 'poses_raw_bytes:uint32', 'poses_compressed_bytes:uint32'],
  layout: ['header', 'zstd_lossless_base', 'zstd_pose_runs'],
  base_encoding_sha256: hash(read('viewer-delta.v1.encoding.json')),
  raw_sha256: 'sha256_of_decompressed_PC01_bytes',
  limits: { ticks: 2048, players: 4, nodes_per_coded_pose: 64, inner_raw_bytes: 67108864 },
  poses: {
    codec: 'local3-fine-v1', space: 'original_parent_local',
    root_origin: 'player_object_data.xyz_or_zero',
    translation_step: '1/65536', scale_step: '1/65536', quaternion_levels: 131071,
    quaternion: 'largest_absolute_component_nonnegative_smallest_three',
    quaternion_quantum: '1/(131071*sqrt(2))', output_numbers: 'float32',
    channels: ['translation_x', 'translation_y', 'translation_z', 'scale', 'quaternion_a', 'quaternion_b', 'quaternion_c', 'quaternion_omitted_index'],
    tracks: ['constant_int32', 'first_difference_zigzag_varint', 'second_difference_zigzag_varint'],
    framing: 'uint16_run_count; each_run(uint16_start,uint8_player,uint16_frames,uint8_bones,uint8_parent_plus_one[bones],bone_major_channel_tracks,uint16_raw_count,(uint16_frame,float64_nodes[bones][13])[raw_count])',
    track_framing: 'uint8_mode,int32_first,zigzag_varint_deltas[mode==0?0:frames-1]',
    error_metric: 'translation_distance + radius * frobenius_scaled_basis_difference_after_float32',
    point_radius: 1, point_error_limit: 0.0002,
    fallback: 'entire_raw_float64_pose_if_bound_exceeded; unknown_models_retained_in_base',
    exactness: 'all_non_pose_fields_exact_numeric_bits_and_array_order; object_key_order_not_significant'
  }
};
const names = {
  projection: 'frontend-default.v4.projection.json', schema: 'halospawns.viewerReplay.v1.frontend-default.v4.schema.json',
  manifest: 'halospawns.viewerReplayDelta.v2.frontend-default.v4.manifest.schema.json', encoding: 'viewer-delta.v2.encoding.json'
};
for (const directory of directories) {
  const registry = JSON.parse(readFileSync(resolve(directory, 'supported-contracts.json'), 'utf8'));
  const entry = { schema: projection.schema, profile: projection.profile, profile_revision: 4, projection_sha256: projectionHash, schema_file: names.schema, projection_file: names.projection, manifest_schema_sha256: hash(manifest), status: 'supported' };
  const encoded = { artifact_kind: encoding.artifact_kind, format: encoding.format, container_version: 2, manifest_schema_file: names.manifest, manifest_schema_sha256: hash(manifest), encoding_file: names.encoding, encoding_sha256: hash(encoding), media_type: encoding.media_type, outer_compression: encoding.outer_compression, status: 'supported' };
  registry.supported_contracts = [...registry.supported_contracts.filter(item => item.profile_revision !== 4), entry];
  registry.supported_encodings = [...registry.supported_encodings.filter(item => item.container_version !== 2), encoded];
  for (const [name, document] of [[names.projection, projection], [names.schema, schema], [names.manifest, manifest], [names.encoding, encoding], ['supported-contracts.json', registry]]) {
    writeFileSync(resolve(directory, name), JSON.stringify(document, null, 2) + '\n');
  }
}
console.log(JSON.stringify({ projection: projectionHash, manifest: hash(manifest), encoding: hash(encoding) }, null, 2));
