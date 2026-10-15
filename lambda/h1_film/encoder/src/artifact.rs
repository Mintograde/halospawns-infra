// The existing projection, schema validators, delta codec and finalizer stay authoritative.
#![allow(dead_code)]
include!("../../../replay_parser/native/src/viewer.rs");

#[path = "float_delta.rs"]
mod float_delta;
#[path = "object_state.rs"]
mod object_state;
#[path = "object_transfer.rs"]
mod object_transfer;
#[path = "ordered_delta.rs"]
mod ordered_delta;
#[path = "pose_state.rs"]
mod pose_state;
#[path = "projection_plan.rs"]
mod projection_plan;
#[path = "tick_hash.rs"]
mod tick_hash;

const LOCAL_CHUNK_RAW_LIMIT: usize = 64 * 1024 * 1024;

pub fn select_revision(revision: u32) -> Result<(), Box<dyn Error>> {
    Projection::load_revision(revision)?;
    PROFILE_REVISION
        .set(revision)
        .map_err(|_| "viewer revision already initialized".into())
}

// Moving whole tick trees between threads increased CPU use in the constrained
// static-glibc build. Windows benefits from the additional bounded pipeline.
#[cfg(windows)]
pub type PrimaryExport = EncodingWorker;
#[cfg(not(windows))]
pub type PrimaryExport = StreamingExport;

impl CompiledProjection {
    fn project_reusing(&self, source: &Value, target: &mut Value) -> Result<(), Box<dyn Error>> {
        match (self, source) {
            (Self::Nullable(inner), _) if !source.is_null() => {
                inner.project_reusing(source, target)
            }
            (Self::Nullable(_), Value::Null) => {
                *target = Value::Null;
                Ok(())
            }
            (Self::Scalar { nullable }, _) => {
                if source.is_array() || source.is_object() || (source.is_null() && !nullable) {
                    return Err("viewer projection expected a JSON scalar".into());
                }
                if let (Value::String(source), Value::String(target)) = (source, &mut *target) {
                    if source != target {
                        target.clone_from(source);
                    }
                } else {
                    *target = source.clone();
                }
                Ok(())
            }
            (
                Self::Object {
                    fields,
                    required,
                    source_indexes,
                },
                Value::Object(source),
            ) if fields.len() <= 64 => {
                for key in required {
                    if source.get(key).is_none_or(Value::is_null) {
                        return Err("viewer projection is missing a required object field".into());
                    }
                }
                let mut selected = [None; 64];
                let mut count = 0;
                for (key, value) in source {
                    if let Some(&index) = source_indexes.get(key)
                        && (!value.is_null() || fields[index].node.nullable())
                    {
                        selected[index] = Some(value);
                        count += 1;
                    }
                }
                let selected = || {
                    fields
                        .iter()
                        .zip(selected)
                        .filter_map(|(field, value)| value.map(|value| (field, value)))
                };
                if let Value::Object(output) = target
                    && output.len() == count
                    && output
                        .keys()
                        .zip(selected())
                        .all(|(key, (field, _))| key == &field.output_key)
                {
                    for (target, (field, value)) in output.values_mut().zip(selected()) {
                        field.node.project_reusing(value, target)?;
                    }
                } else {
                    let mut previous = std::mem::take(target);
                    let mut output = Map::with_capacity(count);
                    for (field, value) in selected() {
                        let (key, mut target) = previous
                            .as_object_mut()
                            .and_then(|old| old.swap_remove_entry(&field.output_key))
                            .unwrap_or_else(|| (field.output_key.clone(), Value::Null));
                        field.node.project_reusing(value, &mut target)?;
                        output.insert(key, target);
                    }
                    *target = Value::Object(output);
                }
                Ok(())
            }
            (
                Self::Array {
                    limit,
                    take_first,
                    items,
                },
                Value::Array(source),
            ) => {
                if !take_first && source.len() > *limit {
                    return Err("viewer projection array exceeds its pinned limit".into());
                }
                if !target.is_array() {
                    *target = Value::Array(Vec::new());
                }
                let output = target.as_array_mut().unwrap();
                output.resize_with(source.len().min(*limit), || Value::Null);
                if let Self::Scalar { nullable } = items.as_ref() {
                    for (source, target) in source.iter().zip(output) {
                        if source.is_array()
                            || source.is_object()
                            || (source.is_null() && !nullable)
                        {
                            return Err("viewer projection expected a JSON scalar".into());
                        }
                        if let (Value::String(source), Value::String(target)) =
                            (source, &mut *target)
                        {
                            if source != target {
                                target.clone_from(source);
                            }
                        } else {
                            *target = source.clone();
                        }
                    }
                    return Ok(());
                }
                for (source, target) in source.iter().zip(output) {
                    items.project_reusing(source, target)?;
                }
                Ok(())
            }
            (Self::Map { limit, values }, Value::Object(source)) => {
                if source.len() > *limit {
                    return Err("viewer projection map exceeds its pinned limit".into());
                }
                let selected = || source.iter().filter(|(_, value)| !value.is_null());
                if let Value::Object(output) = target
                    && output.len() == selected().count()
                    && output
                        .keys()
                        .zip(selected())
                        .all(|(key, (other, _))| key == other)
                {
                    for (target, (_, source)) in output.values_mut().zip(selected()) {
                        values.project_reusing(source, target)?;
                    }
                    Ok(())
                } else {
                    let mut output = Map::with_capacity(source.len());
                    for (key, source) in selected() {
                        let mut target = Value::Null;
                        values.project_reusing(source, &mut target)?;
                        output.insert(key.clone(), target);
                    }
                    *target = Value::Object(output);
                    Ok(())
                }
            }
            _ => {
                *target = self.project(source)?;
                Ok(())
            }
        }
    }

    // The binary transport owns its tick tree. Retain arrays, strings and keys
    // instead of cloning them through the borrowed production-ingest interface.
    fn project_owned(&self, source: Value) -> Result<Value, Box<dyn Error>> {
        match self {
            Self::Nullable(inner) => {
                if source.is_null() {
                    Ok(source)
                } else {
                    inner.project_owned(source)
                }
            }
            Self::Scalar { nullable } => {
                if (source.is_null() && !nullable) || source.is_array() || source.is_object() {
                    return Err("viewer projection expected a JSON scalar".into());
                }
                Ok(source)
            }
            Self::Object {
                fields,
                required,
                source_indexes,
            } => {
                let Value::Object(source) = source else {
                    return Err("viewer projection expected an object".into());
                };
                for key in required {
                    if source.get(key).is_none_or(Value::is_null) {
                        return Err("viewer projection is missing a required object field".into());
                    }
                }
                let mut output = Map::with_capacity(source.len().min(fields.len()));
                let mut selected: Vec<Option<(String, Value)>> =
                    std::iter::repeat_with(|| None).take(fields.len()).collect();
                for (key, value) in source {
                    if let Some(&index) = source_indexes.get(&key) {
                        if !value.is_null() || fields[index].node.nullable() {
                            selected[index] = Some((key, value));
                        }
                    }
                }
                for (field, selected) in fields.iter().zip(selected) {
                    if let Some((key, value)) = selected {
                        let key = if key == field.output_key {
                            key
                        } else {
                            field.output_key.clone()
                        };
                        output.insert(key, field.node.project_owned(value)?);
                    }
                }
                Ok(Value::Object(output))
            }
            Self::Map { limit, values } => {
                let Value::Object(mut source) = source else {
                    return Err("viewer projection expected a dynamic object map".into());
                };
                if source.len() > *limit {
                    return Err("viewer projection map exceeds its pinned limit".into());
                }
                source.retain(|_, value| !value.is_null());
                for value in source.values_mut() {
                    *value = values.project_owned(value.take())?;
                }
                Ok(Value::Object(source))
            }
            Self::Array {
                limit,
                take_first,
                items,
            } => {
                let Value::Array(mut source) = source else {
                    return Err("viewer projection expected an array".into());
                };
                if !take_first && source.len() > *limit {
                    return Err("viewer projection array exceeds its pinned limit".into());
                }
                source.truncate(*limit);
                if let Self::Scalar { nullable } = items.as_ref() {
                    if source.iter().any(|value| {
                        value.is_array() || value.is_object() || (value.is_null() && !nullable)
                    }) {
                        return Err("viewer projection expected a JSON scalar".into());
                    }
                    return Ok(Value::Array(source));
                }
                for value in &mut source {
                    *value = items.project_owned(value.take())?;
                }
                Ok(Value::Array(source))
            }
        }
    }
}

struct IncrementalChunk {
    binary: BinaryWriter,
    previous: Option<Value>,
    before_previous: Option<Value>,
    decoded: Option<DecodedValue>,
    decoded_before: Option<DecodedValue>,
    decoded_strings: Vec<Arc<str>>,
    tick_hash: tick_hash::CachedTickHasher,
    hash_ticks: bool,
    encode_duration: Duration,
    validation_duration: Duration,
    hash_duration: Duration,
    objects_previous: Option<object_state::Records>,
    objects_before: Option<object_state::Records>,
}
impl IncrementalChunk {
    fn new(first_tick: usize, count: usize) -> Result<Self, Box<dyn Error>> {
        let mut binary = BinaryWriter::new();
        binary.bytes(CHUNK_MAGIC);
        binary.byte(CHUNK_VERSION);
        binary.varuint(first_tick as u64)?;
        binary.varuint(count as u64)?;
        Ok(Self {
            binary,
            previous: None,
            before_previous: None,
            decoded: None,
            decoded_before: None,
            decoded_strings: Vec::new(),
            tick_hash: tick_hash::CachedTickHasher::new(),
            hash_ticks: true,
            encode_duration: Duration::ZERO,
            validation_duration: Duration::ZERO,
            hash_duration: Duration::ZERO,
            objects_previous: None,
            objects_before: None,
        })
    }
    fn push(&mut self, next: Value) -> Result<Value, Box<dyn Error>> {
        self.push_state(next, None)
    }

    fn push_state(
        &mut self,
        next: Value,
        objects: Option<object_state::Records>,
    ) -> Result<Value, Box<dyn Error>> {
        let started = Instant::now();
        let offset = self.binary.bytes.len();
        if self.previous.is_some() && objects.is_some() != self.objects_previous.is_some() {
            return Err("incremental object mode changed within a chunk".into());
        }
        if let Some(objects) = &objects {
            object_state::write_tick(
                &mut self.binary,
                self.previous.as_ref(),
                &next,
                self.before_previous.as_ref(),
                self.objects_previous.as_ref(),
                objects,
                self.objects_before.as_ref(),
            )?;
        } else if self.previous.is_none() {
            write_value(&mut self.binary, &next)?;
        } else {
            ordered_delta::write(
                &mut self.binary,
                self.previous.as_ref(),
                &next,
                self.before_previous.as_ref(),
            )?;
        }
        self.encode_duration += started.elapsed();
        if self.binary.bytes.len() > LOCAL_CHUNK_RAW_LIMIT {
            return Err("chunk exceeds the local 64 MiB raw-memory budget".into());
        }
        // Compare the decoder's actual values while the source is still alive.
        // This proves losslessness without serializing/hashing both trees.
        let started = Instant::now();
        let decoded = verify_tick_state(
            &self.binary.bytes[offset..],
            &next,
            self.decoded.as_ref(),
            self.decoded_before.as_ref(),
            &mut self.decoded_strings,
            objects
                .as_ref()
                .map(|objects| (objects, self.objects_previous.as_ref())),
        )?;
        self.validation_duration += started.elapsed();
        let started = Instant::now();
        if self.hash_ticks {
            self.tick_hash.update(&decoded)?;
        }
        self.hash_duration += started.elapsed();
        self.decoded_before = self.decoded.replace(decoded);
        let spare = self.before_previous.take().unwrap_or(Value::Null);
        self.before_previous = self.previous.replace(next);
        self.objects_before = std::mem::replace(&mut self.objects_previous, objects);
        Ok(spare)
    }
}

fn exact_decoded(source: &Value, decoded: &DecodedValue) -> bool {
    match (source, decoded) {
        (Value::Null, DecodedValue::Null) => true,
        (Value::Bool(a), DecodedValue::Bool(b)) => a == b,
        (Value::Number(_), DecodedValue::Number(b)) => {
            number(source).is_some_and(|a| a.to_bits() == b.to_bits())
        }
        (Value::String(a), DecodedValue::String(b)) => a == b.as_ref(),
        (Value::Array(a), DecodedValue::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b.iter()).all(|(a, b)| exact_decoded(a, b))
        }
        (Value::Object(a), DecodedValue::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .zip(b.iter())
                    .all(|((key, a), (other_key, b_value))| {
                        // Optional fields can return in a different insertion order.
                        let value = if key == other_key.as_ref() {
                            Some(b_value)
                        } else {
                            b.get(key.as_str())
                        };
                        value.is_some_and(|b| exact_decoded(a, b))
                    })
        }
        _ => false,
    }
}

fn verify_tick(
    bytes: &[u8],
    source: &Value,
    previous: Option<&DecodedValue>,
    before_previous: Option<&DecodedValue>,
    strings: &mut Vec<Arc<str>>,
) -> Result<DecodedValue, Box<dyn Error>> {
    verify_tick_state(bytes, source, previous, before_previous, strings, None)
}

fn verify_tick_state(
    bytes: &[u8],
    source: &Value,
    previous: Option<&DecodedValue>,
    before_previous: Option<&DecodedValue>,
    strings: &mut Vec<Arc<str>>,
    objects: Option<(&object_state::Records, Option<&object_state::Records>)>,
) -> Result<DecodedValue, Box<dyn Error>> {
    let mut reader = BinaryReader::new(bytes);
    reader.strings = std::mem::take(strings);
    let decoded = if previous.is_none() {
        read_value(&mut reader, 1)?
    } else {
        read_patched_value(&mut reader, previous, before_previous, 1)?
    };
    let exact = match objects {
        Some((objects, prior)) => {
            object_state::exact_tick(source, objects, &decoded, prior, previous)
        }
        None => exact_decoded(source, &decoded),
    };
    if reader.offset != bytes.len() || !exact {
        return Err("viewer delta tick failed lossless validation".into());
    }
    *strings = reader.strings;
    Ok(decoded)
}

struct VerifiedChunk {
    raw: Vec<u8>,
    directory: PathBuf,
    index: usize,
    first_tick: usize,
    tick_count: usize,
    tick_sha256: String,
}

struct PoseBaseCodec;
impl h1_pose_codec::BaseCodec for PoseBaseCodec {
    fn encode(&self, ticks: &[Value], first: usize) -> Result<Vec<u8>, Box<dyn Error>> {
        let mut chunk = IncrementalChunk::new(first, ticks.len())?;
        for tick in ticks {
            chunk.push(tick.clone())?;
        }
        Ok(chunk.binary.bytes)
    }
    fn decode(&self, bytes: &[u8]) -> Result<(usize, Vec<Value>), Box<dyn Error>> {
        let mut reader = BinaryReader::new(bytes);
        if reader.bytes(4)? != CHUNK_MAGIC || reader.byte()? != CHUNK_VERSION {
            return Err("invalid base chunk".into());
        }
        let first = usize::try_from(reader.varuint()?)?;
        let count = usize::try_from(reader.varuint()?)?;
        if !(1..=KEYFRAME_INTERVAL).contains(&count) {
            return Err("invalid base tick count".into());
        }
        let (mut previous, mut before) = (None, None);
        let mut ticks = Vec::with_capacity(count);
        for _ in 0..count {
            let next = if previous.is_none() {
                read_value(&mut reader, 1)?
            } else {
                read_patched_value(&mut reader, previous.as_ref(), before.as_ref(), 1)?
            };
            ticks.push(owned_json(&next)?);
            before = previous.replace(next);
        }
        if reader.offset != bytes.len() {
            return Err("trailing base bytes".into());
        }
        Ok((first, ticks))
    }
}

fn pack_poses(ticks: &[Value], first: usize) -> Result<Vec<u8>, Box<dyn Error>> {
    let settings = h1_pose_codec::settings();
    let (raw, _) = h1_pose_codec::wire::pack(
        ticks,
        first,
        &settings,
        &h1_pose_codec::skeletons(),
        &PoseBaseCodec,
        true,
    )?;
    let (decoded_first, mut decoded) =
        h1_pose_codec::wire::unpack(&raw, &settings, &PoseBaseCodec)?;
    if decoded_first != first {
        return Err("pose chunk offset changed".into());
    }
    h1_pose_codec::verify(ticks, &mut decoded)?;
    if raw.len() > LOCAL_CHUNK_RAW_LIMIT {
        return Err("pose chunk exceeds memory limit".into());
    }
    Ok(raw)
}

#[cfg(test)]
mod pose_tests {
    use super::*;
    use h1_pose_codec::BaseCodec;

    pub(super) fn source() -> Vec<Value> {
        (0..16).map(|frame| {
            let nodes: Vec<_> = (0..19).map(|bone| {
                let angle = (frame + bone) as f64 * 0.017;
                let (s, c) = angle.sin_cos();
                let mut node = [1. + frame as f64 / 128., bone as f64 / 64., 3., 1., c, s, 0., -s, c, 0., 0., 0., 1.];
                if frame == 10 { node[5] += 0.1; }
                node.map(|v| v as f32 as f64)
            }).collect();
            let mut player = serde_json::json!({"player_index":0, "player_object_id":if frame < 8 { 123 } else { 456 },
                "player_object_data":{"tag_name":if frame == 14 { "unknown" } else { "characters\\cyborg_mp\\cyborg_mp" },"x":1.,"y":0.,"z":3.},
                "model_nodes":nodes, "name":"pose fixture", "respawn_timer":0});
            if frame == 3 { player.as_object_mut().unwrap().shift_remove("model_nodes"); }
            if frame == 4 { player["model_nodes"] = serde_json::json!([]); }
            serde_json::json!({"players":[player],"objects":[],"current_tick":frame,
                "current_game_time_seconds":frame as f64/120., "broken_surfaces":frame / 4,
                "game_time_info":{"game_time":frame},"multiplayer_map_name":"prisoner"})
        }).collect()
    }

    #[test]
    fn borrowed_pose_projection_preserves_source_and_batch_bytes() {
        let projection = Projection::load_revision(4).unwrap();
        let mut ticks = source();
        let mut wide = ticks[0].clone();
        wide["players"][0]["model_nodes"][0]
            .as_array_mut()
            .unwrap()
            .push(Value::from(99));
        ticks.push(wide);
        ticks = ticks
            .iter()
            .cycle()
            .take(ticks.len() * 3)
            .cloned()
            .collect();
        let projected: Vec<_> = ticks
            .iter()
            .map(|tick| projection.tick.project(tick).unwrap())
            .collect();
        let expected = pack_poses(&projected, 0).unwrap();
        let root = std::env::temp_dir().join(format!(
            "h1-borrowed-poses-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut stream = StreamingExport::new(&root, ticks.len(), 6).unwrap();
        stream.pose_codec = true;
        stream.validator = crate::fast_schema::Validator::for_revision(4).unwrap();
        for source in ticks {
            let mut tick = source.clone();
            stream
                .push_source_with_projection(&mut tick, &projection)
                .unwrap();
            assert!(deep_exact_equal(&tick, &source));
        }
        stream.sender.take();
        for handle in stream.collector.worker_handles.drain(..) {
            handle.join().unwrap();
        }
        let raw = zstd::bulk::decompress(
            &fs::read(root.join("chunk-00000.hsrd.zst")).unwrap(),
            LOCAL_CHUNK_RAW_LIMIT,
        )
        .unwrap();
        assert_eq!(raw, expected);
        let (_, mut decoded) =
            h1_pose_codec::wire::unpack(&raw, &h1_pose_codec::settings(), &PoseBaseCodec).unwrap();
        h1_pose_codec::verify(&projected, &mut decoded).unwrap();
        drop(stream);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn transferred_objects_match_independent_packer_through_shape_changes() {
        let projection = Projection::load_revision(4).unwrap();
        let mut ticks: Vec<_> = source().into_iter().cycle().take(64).collect();
        for (index, tick) in ticks.iter_mut().enumerate() {
            let mut objects = Vec::new();
            for object in 0..index % 5 {
                let mut value = serde_json::json!({"object_id":object,"object_type":2,"tag_name":"weapons\\pistol\\pistol",
                    "x":index as f64 * 0.125,"y":-0.0,"z":1.0,"forward_x":1.0,"forward_y":0.0,"forward_z":0.0,
                    "up_x":0.0,"up_y":0.0,"up_z":1.0,"parent_ref":-1,"owner_object_ref":-1});
                if index % 7 == 0 {
                    value["unused"] = serde_json::json!([1, 2]);
                }
                if index % 11 == 0 {
                    value.as_object_mut().unwrap().sort_keys();
                }
                objects.push(value);
            }
            tick["objects"] = Value::Array(objects);
        }
        let projected: Vec<_> = ticks
            .iter()
            .map(|tick| projection.tick.project(tick).unwrap())
            .collect();
        let expected = pack_poses(&projected, 0).unwrap();
        let root = std::env::temp_dir().join(format!(
            "h1-object-transfer-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut stream = StreamingExport::new(&root, ticks.len(), 6).unwrap();
        stream.pose_codec = true;
        stream.validator = crate::fast_schema::Validator::for_revision(4).unwrap();
        stream.object_transfer = object_transfer::Layout::compile(&projection.tick);
        assert!(stream.object_transfer.is_some());
        stream.consume_objects = true;
        for mut tick in ticks {
            stream
                .push_source_with_projection(&mut tick, &projection)
                .unwrap();
        }
        stream.sender.take();
        for handle in stream.collector.worker_handles.drain(..) {
            handle.join().unwrap();
        }
        let raw = zstd::bulk::decompress(
            &fs::read(root.join("chunk-00000.hsrd.zst")).unwrap(),
            LOCAL_CHUNK_RAW_LIMIT,
        )
        .unwrap();
        assert_eq!(raw, expected);
        drop(stream);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn retained_objects_and_borrowed_poses_match_independent_packer_across_chunks() {
        let projection = Projection::load_revision(4).unwrap();
        let mut ticks: Vec<_> = source()
            .into_iter()
            .cycle()
            .take(KEYFRAME_INTERVAL + 19)
            .collect();
        for (frame, tick) in ticks.iter_mut().enumerate() {
            let count = if frame % 37 == 0 {
                0
            } else {
                6 - frame / 23 % 3
            };
            let objects = (0..count).map(|index| {
                serde_json::json!({"object_id":index + frame / 101 * 0x10000,"object_type":2,"tag_name":"weapons\\pistol\\pistol",
                    "x":if index == 0 { frame as f64 / 8.0 } else { 1.0 },"y":-0.0,"z":1.0,
                    "forward_x":1.0,"forward_y":0.0,"forward_z":0.0,"up_x":0.0,"up_y":0.0,"up_z":1.0,
                    "parent_ref":-1,"owner_object_ref":-1,"unprojected":frame / 13})
            }).collect();
            tick["objects"] = Value::Array(objects);
            tick["current_tick"] = Value::from(frame);
        }
        let projected: Vec<_> = ticks
            .iter()
            .map(|tick| projection.tick.project(tick).unwrap())
            .collect();
        let bytes = crate::transport::tests::stream(&ticks);
        let mut input = crate::transport::Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let root = std::env::temp_dir().join(format!(
            "h1-retained-state-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut export = StreamingExport::new(&root, ticks.len(), 6).unwrap();
        export.pose_codec = true;
        export.validator = crate::fast_schema::Validator::for_revision(4).unwrap();
        let mut spare = Value::Null;
        while let Some(mut tick) = input.next_incremental(spare).unwrap() {
            input.verify_incremental_source(&tick).unwrap();
            export
                .push_incremental_with_projection(&mut tick, &input.objects, None, &projection)
                .unwrap();
            input.verify_incremental_source(&tick).unwrap();
            spare = tick;
        }
        export.sender.take();
        for handle in export.collector.worker_handles.drain(..) {
            handle.join().unwrap();
        }
        for (index, ticks) in projected.chunks(KEYFRAME_INTERVAL).enumerate() {
            let raw = zstd::bulk::decompress(
                &fs::read(root.join(format!("chunk-{index:05}.hsrd.zst"))).unwrap(),
                LOCAL_CHUNK_RAW_LIMIT,
            )
            .unwrap();
            assert_eq!(raw, pack_poses(ticks, index * KEYFRAME_INTERVAL).unwrap());
            let (_, mut decoded) =
                h1_pose_codec::wire::unpack(&raw, &h1_pose_codec::settings(), &PoseBaseCodec)
                    .unwrap();
            h1_pose_codec::verify(ticks, &mut decoded).unwrap();
        }
        assert!(input.objects.reused > input.objects.decoded);
        drop(export);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn typed_poses_match_batch_bytes_across_player_lifetimes_and_chunks() {
        let projection = Projection::load_revision(4).unwrap();
        let mut ticks: Vec<_> = source()
            .into_iter()
            .cycle()
            .take(KEYFRAME_INTERVAL + 17)
            .collect();
        for (frame, tick) in ticks.iter_mut().enumerate() {
            let original = tick["players"][0].clone();
            for slot in 1..4 {
                let mut player = original.clone();
                player["player_index"] = Value::from(slot);
                player["object_ref"] = Value::from(slot + frame / 13 * 0x10000);
                if slot == 1 && frame % 7 == 0 {
                    player["player_object_data"]["tag_name"] = Value::from("unknown");
                }
                if slot == 2
                    && frame % 11 == 0
                    && let Some(node) = player["model_nodes"]
                        .get_mut(0)
                        .and_then(Value::as_array_mut)
                {
                    node.push(Value::from(99));
                }
                tick["players"].as_array_mut().unwrap().push(player);
            }
            let players = tick["players"].as_array_mut().unwrap();
            if frame % 9 == 0 {
                players.swap(0, 3);
            }
            if frame % 23 == 0 {
                players.truncate(1);
            }
            if frame % 37 == 0 {
                players.clear();
            }
            for player in players {
                if frame % 17 == 0 {
                    player.as_object_mut().unwrap().sort_keys();
                }
                player["source_only"] = serde_json::json!({"values":[null,-0.0]});
            }
            tick["objects"] =
                serde_json::json!([{"object_id":65537,"object_type":2,"x":frame / 7}]);
            tick["current_tick"] = Value::from(frame);
        }
        let bytes = crate::transport::tests::packed_stream(&ticks);
        let mut reference =
            crate::transport::Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let mut projected = Vec::new();
        while let Some(tick) = reference.next().unwrap() {
            projected.push(projection.tick.project(&tick).unwrap());
        }
        let root = std::env::temp_dir().join(format!(
            "h1-typed-poses-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut export = StreamingExport::new(&root, ticks.len(), 6).unwrap();
        export.pose_codec = true;
        export.validator = crate::fast_schema::Validator::for_revision(4).unwrap();
        export.typed_pose_layout = pose_state::Layout::compile(&projection, &export.validator);
        assert!(export.typed_pose_layout.is_some());
        let mut input = crate::transport::Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let mut spare = Value::Null;
        while let Some(mut tick) = input.next_incremental_with_poses(spare, true).unwrap() {
            input.verify_incremental_source(&tick).unwrap();
            if export.collector.tick_count.is_multiple_of(4) {
                let frame = export.collector.tick_count;
                let mut sample = tick.clone();
                sample["objects"] = input.objects.materialize();
                input.poses.materialize(&mut sample).unwrap();
                let mut expected = ticks[frame].clone();
                crate::sampling::normalize(&mut sample, frame, 4, "prisoner").unwrap();
                crate::sampling::normalize(&mut expected, frame, 4, "prisoner").unwrap();
                assert_eq!(
                    serde_json::to_vec(&sample).unwrap(),
                    serde_json::to_vec(&expected).unwrap()
                );
            }
            export
                .push_incremental_with_projection(
                    &mut tick,
                    &input.objects,
                    Some(&input.poses),
                    &projection,
                )
                .unwrap();
            input.verify_incremental_source(&tick).unwrap();
            spare = tick;
        }
        assert!(input.poses.decoded > 4000);
        export.sender.take();
        for handle in export.collector.worker_handles.drain(..) {
            handle.join().unwrap();
        }
        for (index, ticks) in projected.chunks(KEYFRAME_INTERVAL).enumerate() {
            let raw = zstd::bulk::decompress(
                &fs::read(root.join(format!("chunk-{index:05}.hsrd.zst"))).unwrap(),
                LOCAL_CHUNK_RAW_LIMIT,
            )
            .unwrap();
            assert_eq!(raw, pack_poses(ticks, index * KEYFRAME_INTERVAL).unwrap());
            let (_, mut decoded) =
                h1_pose_codec::wire::unpack(&raw, &h1_pose_codec::settings(), &PoseBaseCodec)
                    .unwrap();
            h1_pose_codec::verify(ticks, &mut decoded).unwrap();
        }
        drop(export);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fine_pose_wire_roundtrip_lifecycle_fallback_and_golden() {
        let ticks = source();
        let raw = pack_poses(&ticks, 0).unwrap();
        let golden: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/pose-v1.json")).unwrap();
        assert_eq!(serde_json::to_value(&raw).unwrap(), golden["raw"]);
        let mut poses = h1_pose_codec::wire::Encoder::new(
            &h1_pose_codec::settings(),
            &h1_pose_codec::skeletons(),
            true,
        )
        .unwrap();
        let mut base = IncrementalChunk::new(0, ticks.len()).unwrap();
        base.hash_ticks = false;
        for (frame, mut tick) in ticks.clone().into_iter().enumerate() {
            let removed = poses.push_recycling(&mut tick).unwrap();
            if matches!(frame, 3 | 4 | 14) {
                assert!(removed.iter().all(Option::is_none));
            } else {
                assert_eq!(
                    removed[0].as_ref(),
                    ticks[frame]["players"][0].get("model_nodes")
                );
                assert!(tick["players"][0].get("model_nodes").is_none());
            }
            base.push(tick).unwrap();
        }
        assert_eq!(poses.finish(&base.binary.bytes).unwrap().0, raw);
        let (first, mut decoded) =
            h1_pose_codec::wire::unpack(&raw, &h1_pose_codec::settings(), &PoseBaseCodec).unwrap();
        assert_eq!(first, 0);
        assert_eq!(decoded[3]["players"][0].get("model_nodes"), None);
        assert_eq!(
            decoded[4]["players"][0]["model_nodes"],
            serde_json::json!([])
        );
        for frame in [10, 14] {
            assert!(
                h1_pose_codec::verify(&ticks[frame..frame + 1], &mut decoded[frame..frame + 1])
                    .is_ok()
            );
        }
        let fixture = serde_json::json!({"raw":raw,"source":ticks,"decoded":decoded});
        if let Ok(path) = std::env::var("H1_POSE_GOLDEN") {
            fs::write(path, serde_json::to_vec(&fixture).unwrap()).unwrap();
        }
        let errors = h1_pose_codec::verify(&ticks, &mut decoded).unwrap();
        assert!(errors.nodes > 0);
        assert!(errors.max_point_bound < 0.0002);
        for length in [0, 1, 4, 19, raw.len() - 1] {
            assert!(
                h1_pose_codec::wire::unpack(
                    &raw[..length],
                    &h1_pose_codec::settings(),
                    &PoseBaseCodec
                )
                .is_err()
            );
        }
        let mut bad = raw.clone();
        bad[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(
            h1_pose_codec::wire::unpack(&bad, &h1_pose_codec::settings(), &PoseBaseCodec).is_err()
        );
        assert!(
            h1_pose_codec::wire::pack(
                &[],
                0,
                &h1_pose_codec::settings(),
                &[],
                &PoseBaseCodec,
                true
            )
            .is_err()
        );
        assert!(PoseBaseCodec.decode(b"invalid").is_err());
    }
}

fn compress_verified(
    task: VerifiedChunk,
    compressor: &mut zstd::bulk::Compressor<'static>,
    decompressor: &mut zstd::bulk::Decompressor<'static>,
    compressed: &mut Vec<u8>,
    validation: &mut Vec<u8>,
) -> Result<ChunkWorkResult, Box<dyn Error>> {
    let started = Instant::now();
    compressed.clear();
    let capacity = zstd::zstd_safe::compress_bound(task.raw.len());
    if compressed.capacity() < capacity {
        compressed.reserve(capacity);
    }
    compressor.compress_to_buffer(&task.raw, compressed)?;
    let compression_duration_ms = started.elapsed().as_millis();
    let started = Instant::now();
    validate_zstd_round_trip(decompressor, compressed, &task.raw, validation)?;
    let validation_duration_ms = started.elapsed().as_millis();
    let compressed_file = format!("chunk-{:05}.hsrd.zst", task.index);
    let started = Instant::now();
    fs::write(task.directory.join(&compressed_file), &compressed)?;
    Ok(ChunkWorkResult {
        part: ChunkPart {
            index: task.index,
            first_tick: task.first_tick,
            tick_count: task.tick_count,
            raw_bytes: task.raw.len(),
            compressed_file,
            compressed_bytes: compressed.len(),
            compressed_sha256: sha256_hex(compressed),
            tick_sha256: task.tick_sha256,
        },
        validation_duration_ms,
        tick_hash_duration_ms: 0,
        compression_duration_ms,
        chunk_write_duration_ms: started.elapsed().as_millis(),
    })
}

fn local_collector(
    directory: &Path,
    level: i32,
) -> Result<(ViewerWriter, SyncSender<VerifiedChunk>), Box<dyn Error>> {
    fs::create_dir(directory)?;
    projection()?;
    let (sender, receiver) = mpsc::sync_channel::<VerifiedChunk>(1);
    let (results, result_receiver) = mpsc::channel();
    // One bounded compression worker per output. The default level 6 needs far
    // less time and workspace than the production batch encoder's level 19.
    let handle = thread::spawn(move || {
        let work = || -> Result<(), Box<dyn Error>> {
            let mut compressor = zstd::bulk::Compressor::new(level)?;
            compressor.include_checksum(true)?;
            compressor.include_contentsize(true)?;
            let mut decompressor = zstd::bulk::Decompressor::new()?;
            let mut compressed = Vec::new();
            let mut validation = Vec::new();
            while let Ok(task) = receiver.recv() {
                let result = compress_verified(
                    task,
                    &mut compressor,
                    &mut decompressor,
                    &mut compressed,
                    &mut validation,
                )?;
                if results.send(Ok(result)).is_err() {
                    return Ok(());
                }
            }
            Ok(())
        };
        if let Err(error) = work() {
            let _ = results.send(Err(error.to_string()));
        }
    });
    Ok((
        ViewerWriter {
            directory: directory.to_owned(),
            task_sender: None,
            result_receiver,
            worker_handles: vec![handle],
            worker_count: 1,
            started: Instant::now(),
            projection_duration: Duration::ZERO,
            encode_duration_ms: 0,
            tick_hash_duration_ms: 0,
            validation_duration_ms: 0,
            compression_duration_ms: 0,
            chunk_write_duration_ms: 0,
            pending: Vec::new(),
            pending_semantic_digests: Vec::new(),
            tick_count: 0,
            dispatched_chunks: 0,
            raw_chunk_bytes: 0,
            compressed_chunk_bytes: 0,
            chunks: Vec::new(),
        },
        sender,
    ))
}

pub struct StreamingExport {
    collector: ViewerWriter,
    sender: Option<SyncSender<VerifiedChunk>>,
    chunk: Option<IncrementalChunk>,
    poses: Option<h1_pose_codec::wire::Encoder>,
    pose_duration: Duration,
    pose_codec: bool,
    chunk_ticks: usize,
    expected: usize,
    spare: Value,
    pose_spares: [Option<Value>; 4],
    pose_models: Vec<h1_pose_codec::pose::Skeleton>,
    validator: crate::fast_schema::Validator,
    projection_plan: projection_plan::Plan,
    object_transfer: Option<object_transfer::Layout>,
    consume_objects: bool,
    object_cache: object_state::ProjectionCache,
    pending_objects: Option<object_state::Records>,
    typed_pose_layout: Option<pose_state::Layout>,
}
impl StreamingExport {
    pub fn new(directory: &Path, expected: usize, level: i32) -> Result<Self, Box<dyn Error>> {
        if !(1..=MAX_TICKS).contains(&expected) || !(1..=19).contains(&level) {
            return Err("invalid tick count or compression level".into());
        }
        let (collector, sender) = local_collector(directory, level)?;
        let validator = crate::fast_schema::Validator::for_revision(projection()?.revision)?;
        let typed_pose_layout = pose_state::Layout::compile(projection()?, &validator);
        Ok(Self {
            collector,
            sender: Some(sender),
            chunk: None,
            poses: None,
            pose_duration: Duration::ZERO,
            pose_codec: projection()?.revision == 4,
            chunk_ticks: 0,
            expected,
            spare: Value::Null,
            pose_spares: [None, None, None, None],
            pose_models: h1_pose_codec::skeletons(),
            validator,
            projection_plan: projection_plan::Plan::default(),
            object_transfer: object_transfer::Layout::compile(&projection()?.tick),
            consume_objects: false,
            object_cache: object_state::ProjectionCache::default(),
            pending_objects: None,
            typed_pose_layout,
        })
    }
    pub fn push(&mut self, source: &Value) -> Result<(), Box<dyn Error>> {
        self.push_with_projection(source, projection()?)
    }

    fn push_with_projection(
        &mut self,
        source: &Value,
        projection: &Projection,
    ) -> Result<(), Box<dyn Error>> {
        let started = Instant::now();
        validate_json_safety(source, 3)?;
        let mut projected = std::mem::take(&mut self.spare);
        // Pose extraction removes these arrays from the delta history. Return
        // their storage to the next projection instead of allocating every tick.
        if let Some(players) = projected.get_mut("players").and_then(Value::as_array_mut) {
            for (player, nodes) in players.iter_mut().zip(&mut self.pose_spares) {
                if let (Some(player), Some(nodes)) = (player.as_object_mut(), nodes.take()) {
                    player.insert("model_nodes".into(), nodes);
                }
            }
        }
        self.projection_plan
            .project(&projection.tick, source, &mut projected)?;
        if !self.validator.is_valid(&projected) {
            return Err("viewer tick violates its closed schema".into());
        }
        self.spare = self.push_projected(projected, started.elapsed())?;
        Ok(())
    }

    pub fn push_source(&mut self, source: &mut Value) -> Result<(), Box<dyn Error>> {
        self.push_source_with_projection(source, projection()?)
    }

    pub fn push_transport_source(&mut self, source: &mut Value) -> Result<(), Box<dyn Error>> {
        self.consume_objects = true;
        let result = self.push_source_with_projection(source, projection()?);
        self.consume_objects = false;
        result
    }

    pub fn supports_incremental(&self) -> bool {
        self.pose_codec
            && projection().is_ok_and(|projection| {
                object_state::ProjectionCache::layout(projection, &self.validator).is_some()
            })
    }

    pub fn supports_typed_poses(&self) -> bool {
        self.supports_incremental() && self.typed_pose_layout.is_some()
    }

    pub fn push_incremental_source(
        &mut self,
        source: &mut Value,
        objects: &crate::transport::ObjectState,
        poses: Option<&crate::transport::PoseState>,
    ) -> Result<(), Box<dyn Error>> {
        self.push_incremental_with_projection(source, objects, poses, projection()?)
    }

    fn push_incremental_with_projection(
        &mut self,
        source: &mut Value,
        objects: &crate::transport::ObjectState,
        poses: Option<&crate::transport::PoseState>,
        projection: &Projection,
    ) -> Result<(), Box<dyn Error>> {
        let started = Instant::now();
        self.pending_objects = Some(self.object_cache.project(
            objects.records(),
            projection,
            &self.validator,
        )?);
        self.collector.projection_duration += started.elapsed();
        if let Some(poses) = poses
            && poses.slices().iter().any(Option::is_some)
        {
            let started = Instant::now();
            self.typed_pose_layout
                .as_ref()
                .ok_or("unsupported typed pose layout")?
                .validate(poses)?;
            validate_json_safety(source, 3)?;
            let mut projected = std::mem::take(&mut self.spare);
            self.projection_plan
                .project(&projection.tick, source, &mut projected)?;
            if !self.validator.is_valid(&projected) {
                return Err("viewer tick violates its closed schema".into());
            }
            self.spare =
                self.push_projected_with_poses(projected, started.elapsed(), poses.slices())?;
            return Ok(());
        }
        self.push_source_with_projection(source, projection)
    }

    fn push_source_with_projection(
        &mut self,
        source: &mut Value,
        projection: &Projection,
    ) -> Result<(), Box<dyn Error>> {
        if !self.pose_codec {
            return self.push_with_projection(source, projection);
        }
        let mut borrowed = [false; 4];
        if let Some(players) = source.get("players").and_then(Value::as_array) {
            for (player, borrow) in players.iter().zip(&mut borrowed) {
                let tag = player["player_object_data"]["tag_name"].as_str();
                if let Some(nodes) = player.get("model_nodes").and_then(Value::as_array) {
                    *borrow = self.pose_models.iter().any(|rig| {
                        Some(rig.tag.as_str()) == tag && rig.parents.len() == nodes.len()
                    }) && nodes.iter().all(|node| {
                        node.as_array()
                            .is_some_and(|v| v.len() == 13 && v.iter().all(Value::is_number))
                    });
                }
            }
        }
        if !borrowed.iter().any(|v| *v) {
            return self.push_with_projection(source, projection);
        }
        let started = Instant::now();
        validate_json_safety(source, 3)?;
        let mut nodes = [None, None, None, None];
        for (i, player) in source["players"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .take(4)
            .enumerate()
        {
            if borrowed[i] {
                nodes[i] = Some(std::mem::replace(
                    &mut player["model_nodes"],
                    Value::Array(Vec::new()),
                ));
            }
        }
        let mut projected = std::mem::take(&mut self.spare);
        let transferred = self
            .consume_objects
            .then(|| {
                self.object_transfer
                    .as_ref()
                    .and_then(|layout| layout.take(source, &mut projected))
            })
            .flatten();
        self.projection_plan
            .project(&projection.tick, source, &mut projected)?;
        if let Some((objects, spare)) = transferred {
            projected["objects"] = objects;
            source["objects"] = spare;
        }
        for (i, player) in projected["players"]
            .as_array_mut()
            .ok_or("missing projected players")?
            .iter_mut()
            .enumerate()
        {
            if let Some(nodes) = nodes[i].take() {
                player["model_nodes"] = nodes;
            }
        }
        // Only canonical, untruncated matrices are lent. Validate the complete
        // projection before extraction, and return their storage to transport.
        if !self.validator.is_valid(&projected) {
            return Err("viewer tick violates its closed schema".into());
        }
        self.spare = self.push_projected(projected, started.elapsed())?;
        for (i, player) in source["players"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .take(4)
            .enumerate()
        {
            if borrowed[i] {
                player["model_nodes"] = self.pose_spares[i]
                    .take()
                    .ok_or("borrowed pose was not extracted")?;
            }
        }
        Ok(())
    }
    pub fn push_owned(&mut self, source: Value) -> Result<(), Box<dyn Error>> {
        self.push_recycled(source).map(|_| ())
    }
    pub fn push_recycled(&mut self, source: Value) -> Result<Value, Box<dyn Error>> {
        let started = Instant::now();
        validate_json_safety(&source, 3)?;
        let projected = projection()?.tick.project_owned(source)?;
        if !projection()?.tick_validator.is_valid(&projected) {
            return Err("viewer tick violates its closed schema".into());
        }
        self.push_projected(projected, started.elapsed())
    }
    fn push_projected(
        &mut self,
        projected: Value,
        duration: Duration,
    ) -> Result<Value, Box<dyn Error>> {
        self.push_projected_with_poses(projected, duration, [None; 4])
    }

    fn push_projected_with_poses(
        &mut self,
        mut projected: Value,
        duration: Duration,
        typed: [Option<&[h1_pose_codec::pose::Node]>; 4],
    ) -> Result<Value, Box<dyn Error>> {
        if self.collector.tick_count >= self.expected {
            return Err("too many source ticks".into());
        }
        self.collector.projection_duration += duration;
        if self.chunk.is_none() {
            let first = self.collector.tick_count;
            self.chunk = Some(IncrementalChunk::new(
                first,
                KEYFRAME_INTERVAL.min(self.expected - first),
            )?);
            if self.pose_codec {
                // Revision 4 authenticates the raw PC01 block, not reconstructed JSON.
                self.chunk.as_mut().unwrap().hash_ticks = false;
                self.poses = Some(h1_pose_codec::wire::Encoder::new(
                    &h1_pose_codec::settings(),
                    &h1_pose_codec::skeletons(),
                    true,
                )?);
            }
        }
        if let Some(poses) = &mut self.poses {
            let started = Instant::now();
            self.pose_spares = poses.push_typed_recycling(&mut projected, typed)?;
            self.pose_duration += started.elapsed();
        }
        let spare = self
            .chunk
            .as_mut()
            .unwrap()
            .push_state(projected, self.pending_objects.take())?;
        self.chunk_ticks += 1;
        self.collector.tick_count += 1;
        if self.chunk_ticks == KEYFRAME_INTERVAL || self.collector.tick_count == self.expected {
            let chunk = self.chunk.take().unwrap();
            self.collector.encode_duration_ms += chunk.encode_duration.as_millis();
            self.collector.validation_duration_ms += chunk.validation_duration.as_millis();
            self.collector.tick_hash_duration_ms += chunk.hash_duration.as_millis();
            let (raw, tick_sha256) = if let Some(poses) = self.poses.take() {
                let started = Instant::now();
                let (raw, _) = poses.finish(&chunk.binary.bytes)?;
                self.pose_duration += started.elapsed();
                self.collector.encode_duration_ms += self.pose_duration.as_millis();
                self.pose_duration = Duration::ZERO;
                let hash = sha256_hex(&raw);
                (raw, hash)
            } else {
                (chunk.binary.bytes, chunk.tick_hash.finish())
            };
            self.collector.raw_chunk_bytes += raw.len() as u64;
            if self.collector.raw_chunk_bytes > MAX_UNCOMPRESSED_BYTES {
                return Err("raw replay exceeds contract limit".into());
            }
            self.sender
                .as_ref()
                .unwrap()
                .send(VerifiedChunk {
                    directory: self.collector.directory.clone(),
                    index: self.collector.dispatched_chunks,
                    first_tick: self.collector.tick_count - self.chunk_ticks,
                    tick_count: self.chunk_ticks,
                    raw,
                    tick_sha256,
                })
                .map_err(|_| "compression worker closed")?;
            self.chunk_ticks = 0;
            self.collector.dispatched_chunks += 1;
            self.collector.collect_ready_results()?;
        }
        Ok(spare)
    }
    pub fn finish(
        mut self,
        metadata: &Map<String, Value>,
        output: &Path,
        replay_id: &str,
        recorded_at: &str,
    ) -> Result<ContainerResult, Box<dyn Error>> {
        if self.collector.tick_count != self.expected
            || self.chunk.is_some()
            || self.poses.is_some()
        {
            return Err("incomplete tick stream".into());
        }
        self.sender.take();
        self.collector.finish(metadata)?;
        let directory = &self.collector.directory;
        let parts: PartsDescriptor =
            serde_json::from_reader(BufReader::new(File::open(directory.join("parts.json"))?))?;
        let mut offset = 0;
        let chunks: Vec<_> = parts.chunks.iter().map(|part| {
            let mut chunk = serde_json::json!({"index":part.index, "firstTick":part.first_tick,
                "tickCount":part.tick_count, "offset":offset, "compressedBytes":part.compressed_bytes,
                "rawBytes":part.raw_bytes, "compressedSha256":part.compressed_sha256, "tickSha256":part.tick_sha256});
            if self.pose_codec {
                let hash = chunk.as_object_mut().unwrap().shift_remove("tickSha256").unwrap();
                chunk["rawSha256"] = hash;
            }
            offset += part.compressed_bytes;
            chunk
        }).collect();
        let manifest = serde_json::json!({"format":viewer_format(parts.source_contract.profile_revision), "sourceContract":parts.source_contract,
            "replayId":replay_id, "recordedAt":recorded_at, "keyframeInterval":KEYFRAME_INTERVAL,
            "tickCount":parts.tick_count, "chunks":chunks, "replay":parts.replay});
        let path = directory.join("manifest.json");
        fs::write(&path, serde_json::to_vec(&manifest)?)?;
        finalize_container(directory, &path, output)
    }
}

impl Drop for StreamingExport {
    fn drop(&mut self) {
        self.sender.take();
        for worker in self.collector.worker_handles.drain(..) {
            let _ = worker.join();
        }
    }
}

// One queued batch, one being processed, and one being filled: at most 24 ticks.
pub struct EncodingWorker {
    sender: Option<SyncSender<Vec<Value>>>,
    pending: Vec<Value>,
    worker: Option<JoinHandle<Result<StreamingExport, String>>>,
}

impl EncodingWorker {
    const BATCH: usize = 8;

    pub fn push(&mut self, source: &Value) -> Result<(), Box<dyn Error>> {
        self.push_owned(source.clone())
    }

    pub fn push_source(&mut self, source: &mut Value) -> Result<(), Box<dyn Error>> {
        self.push(source)
    }

    pub fn push_transport_source(&mut self, source: &mut Value) -> Result<(), Box<dyn Error>> {
        self.push_source(source)
    }

    pub fn supports_incremental(&self) -> bool {
        false
    }

    pub fn supports_typed_poses(&self) -> bool {
        false
    }

    pub fn push_incremental_source(
        &mut self,
        source: &mut Value,
        objects: &crate::transport::ObjectState,
        poses: Option<&crate::transport::PoseState>,
    ) -> Result<(), Box<dyn Error>> {
        source["objects"] = objects.materialize();
        if let Some(poses) = poses {
            poses.materialize(source)?;
        }
        self.push_source(source)
    }

    pub fn new(directory: &Path, expected: usize, level: i32) -> Result<Self, Box<dyn Error>> {
        let mut export = StreamingExport::new(directory, expected, level)?;
        let (sender, receiver) = mpsc::sync_channel::<Vec<Value>>(1);
        let worker = thread::spawn(move || {
            for batch in receiver {
                for tick in batch {
                    export.push_owned(tick).map_err(|error| error.to_string())?;
                }
            }
            Ok(export)
        });
        Ok(Self {
            sender: Some(sender),
            pending: Vec::with_capacity(Self::BATCH),
            worker: Some(worker),
        })
    }

    pub fn push_owned(&mut self, tick: Value) -> Result<(), Box<dyn Error>> {
        self.pending.push(tick);
        if self.pending.len() == Self::BATCH {
            self.flush()?;
        }
        Ok(())
    }

    pub fn push_recycled(&mut self, tick: Value) -> Result<Value, Box<dyn Error>> {
        self.push_owned(tick)?;
        Ok(Value::Null)
    }

    fn flush(&mut self) -> Result<(), Box<dyn Error>> {
        if !self.pending.is_empty() {
            let batch = std::mem::replace(&mut self.pending, Vec::with_capacity(Self::BATCH));
            if self
                .sender
                .as_ref()
                .ok_or("encoding worker closed")?
                .send(batch)
                .is_err()
            {
                self.sender.take();
                if let Some(worker) = self.worker.take() {
                    match worker.join() {
                        Ok(Err(message)) => return Err(message.into()),
                        Err(_) => return Err("encoding worker panicked".into()),
                        Ok(Ok(_)) => {}
                    }
                }
                return Err("encoding worker stopped before accepting all ticks".into());
            }
        }
        Ok(())
    }

    pub fn finish(
        mut self,
        metadata: &Map<String, Value>,
        output: &Path,
        replay_id: &str,
        recorded_at: &str,
    ) -> Result<ContainerResult, Box<dyn Error>> {
        self.flush()?;
        self.sender.take();
        let export = self
            .worker
            .take()
            .unwrap()
            .join()
            .map_err(|_| "encoding worker panicked")??;
        export.finish(metadata, output, replay_id, recorded_at)
    }
}

impl Drop for EncodingWorker {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub fn value_hash(value: &Value) -> Result<[u8; 32], Box<dyn Error>> {
    semantic_value_digest(value)
}

#[cfg(test)]
mod performance_tests {
    use super::*;

    #[test]
    #[ignore = "set H1_BENCH_CHUNK to a retained .hsrd.zst chunk"]
    fn profile_projection_stages() {
        let path = std::env::var("H1_BENCH_CHUNK").unwrap();
        let raw = zstd::bulk::decompress(&fs::read(path).unwrap(), LOCAL_CHUNK_RAW_LIMIT).unwrap();
        let (_, ticks) = decode_chunk(&raw).unwrap();
        let projection = projection().unwrap();
        let mut safety = Duration::ZERO;
        let mut project = Duration::ZERO;
        let mut owned_project = Duration::ZERO;
        let mut schema = Duration::ZERO;
        let mut semantic = Duration::ZERO;
        for tick in &ticks {
            let start = Instant::now();
            validate_json_safety(tick, 3).unwrap();
            safety += start.elapsed();
            let start = Instant::now();
            let selected = projection.tick.project(tick).unwrap();
            project += start.elapsed();
            let start = Instant::now();
            assert!(projection.tick_validator.is_valid(&selected));
            schema += start.elapsed();
            let start = Instant::now();
            std::hint::black_box(semantic_value_digest(&selected).unwrap());
            semantic += start.elapsed();
            let owned = tick.clone();
            let start = Instant::now();
            let owned = projection.tick.project_owned(owned).unwrap();
            owned_project += start.elapsed();
            assert!(deep_exact_equal(&owned, &selected));
        }
        let start = Instant::now();
        let decoded = decode_chunk_semantic_hash(&raw).unwrap();
        eprintln!(
            "ticks={} safety={safety:?} projection={project:?} owned_projection={owned_project:?} schema={schema:?} semantic={semantic:?} decoded_total={:?} tick_hash={:?}",
            ticks.len(),
            start.elapsed(),
            decoded.tick_hash_duration
        );
    }
}

struct Scan {
    manifest: ViewerManifest,
    selected_hash: String,
    file_hash: String,
    bytes: u64,
}

fn owned_json(value: &DecodedValue) -> Result<Value, Box<dyn Error>> {
    Ok(match value {
        DecodedValue::Null => Value::Null,
        DecodedValue::Bool(v) => Value::Bool(*v),
        DecodedValue::Number(v) => {
            Value::Number(Number::from_f64(*v).ok_or("non-finite decoded value")?)
        }
        DecodedValue::String(v) => Value::String(v.to_string()),
        DecodedValue::Array(values) => {
            Value::Array(values.iter().map(owned_json).collect::<Result<_, _>>()?)
        }
        DecodedValue::Object(values) => Value::Object(
            values
                .iter()
                .map(|(k, v)| Ok((k.to_string(), owned_json(v)?)))
                .collect::<Result<_, Box<dyn Error>>>()?,
        ),
    })
}

fn scan(path: &Path, stride: usize) -> Result<Scan, Box<dyn Error>> {
    use std::io::{Seek, SeekFrom};
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    if !(32..=MAX_ARTIFACT_BYTES).contains(&size) {
        return Err("artifact exceeds size limits".into());
    }
    let mut header = [0; 32];
    file.read_exact(&mut header)?;
    let u32_at = |start| u32::from_le_bytes(header[start..start + 4].try_into().unwrap()) as usize;
    let pose_codec = &header[..8] == b"HSRDC002" && header[8..12] == [32, 0, 2, 0];
    if (!pose_codec && (&header[..8] != CONTAINER_MAGIC || header[8..12] != [32, 0, 1, 0]))
        || u32_at(12) != 1
        || u32_at(24) as u64 != size
        || u32_at(28) != 0
    {
        return Err("invalid replay container header".into());
    }
    let compressed_size = u32_at(16);
    let raw_size = u32_at(20);
    if compressed_size == 0
        || compressed_size > 16 * 1024 * 1024
        || compressed_size as u64 > size - 32
        || raw_size == 0
        || raw_size > 64 * 1024 * 1024
    {
        return Err("manifest exceeds local validation limits".into());
    }
    let mut compressed = vec![0; compressed_size];
    file.read_exact(&mut compressed)?;
    let raw = zstd::bulk::decompress(&compressed, raw_size)?;
    if raw.len() != raw_size {
        return Err("manifest raw length differs".into());
    }
    let value: Value = serde_json::from_slice(&raw)?;
    let revision = u32::try_from(
        value["sourceContract"]["profile_revision"]
            .as_u64()
            .ok_or("missing revision")?,
    )?;
    if pose_codec != (revision == 4) {
        return Err("container/contract version mismatch".into());
    }
    let selected_projection = Projection::load_revision(revision)?;
    let schema: Value = serde_json::from_str(manifest_schema_json(revision)?)?;
    if !jsonschema::validator_for(&schema)?.is_valid(&value) {
        return Err("manifest violates its pinned schema".into());
    }
    let manifest: ViewerManifest = serde_json::from_value(value)?;
    manifest.source_contract.validate(manifest.tick_count)?;
    if manifest.keyframe_interval != KEYFRAME_INTERVAL
        || !(1..=MAX_TICKS).contains(&manifest.tick_count)
        || manifest.chunks.len() != manifest.tick_count.div_ceil(KEYFRAME_INTERVAL)
    {
        return Err("invalid chunk schedule".into());
    }
    let map = manifest
        .replay
        .get("game_meta")
        .and_then(|v| v.get("map_name"))
        .and_then(Value::as_str)
        .ok_or("missing replay map")?;
    let mut tick_count = 0;
    let mut offset = 0_u64;
    let mut total_raw = raw_size as u64;
    let mut selected_hash = Sha256::new();
    let chunks_start = 32 + compressed_size as u64;
    // Every chunk starts cold; pose decoding retains at most one bounded chunk.
    for (index, chunk) in manifest.chunks.iter().enumerate() {
        if chunk.index != index
            || chunk.first_tick != tick_count
            || chunk.offset != offset
            || chunk.tick_count != KEYFRAME_INTERVAL.min(manifest.tick_count - tick_count)
            || chunk.compressed_bytes == 0
            || chunk.compressed_bytes > 64 * 1024 * 1024
            || chunk.raw_bytes == 0
            || chunk.raw_bytes > LOCAL_CHUNK_RAW_LIMIT
            || chunk.compressed_bytes as u64 > size.saturating_sub(chunks_start + offset)
        {
            return Err("invalid chunk coverage, offset or size".into());
        }
        file.seek(SeekFrom::Start(chunks_start + offset))?;
        compressed.resize(chunk.compressed_bytes, 0);
        file.read_exact(&mut compressed)?;
        if sha256_hex(&compressed) != chunk.compressed_sha256 {
            return Err("compressed chunk hash mismatch".into());
        }
        let raw = zstd::bulk::decompress(&compressed, chunk.raw_bytes)?;
        if raw.len() != chunk.raw_bytes {
            return Err("raw chunk length mismatch".into());
        }
        let mut reader = BinaryReader::new(&raw);
        let mut pose_ticks = if pose_codec {
            if sha256_hex(&raw) != chunk.tick_sha256 {
                return Err("pose raw hash mismatch".into());
            }
            let (first, ticks) =
                h1_pose_codec::wire::unpack(&raw, &h1_pose_codec::settings(), &PoseBaseCodec)?;
            if first != chunk.first_tick || ticks.len() != chunk.tick_count {
                return Err("pose tick coverage differs".into());
            }
            Some(ticks.into_iter())
        } else {
            None
        };
        if !pose_codec
            && (reader.bytes(4)? != CHUNK_MAGIC
                || reader.byte()? != CHUNK_VERSION
                || reader.varuint()? != chunk.first_tick as u64
                || reader.varuint()? != chunk.tick_count as u64)
        {
            return Err("chunk header differs from manifest".into());
        }
        let mut previous = None;
        let mut before_previous = None;
        let mut tick_hash = TickHasher::new();
        for _ in 0..chunk.tick_count {
            let next = if pose_codec {
                None
            } else if previous.is_none() {
                Some(read_value(&mut reader, 1)?)
            } else {
                Some(read_patched_value(
                    &mut reader,
                    previous.as_ref(),
                    before_previous.as_ref(),
                    1,
                )?)
            };
            let mut tick = if let Some(next) = &next {
                tick_hash.update(next)?;
                owned_json(next)?
            } else {
                pose_ticks
                    .as_mut()
                    .unwrap()
                    .next()
                    .ok_or("missing pose tick")?
            };
            if !selected_projection.tick_validator.is_valid(&tick) {
                return Err("decoded tick violates its schema".into());
            }
            if number(&tick["current_tick"]) != Some(tick_count as f64)
                || number(&tick["game_time_info"]["game_time"]) != Some(tick_count as f64)
                || number(&tick["current_game_time_seconds"])
                    != Some((tick_count * stride) as f64 / 120.0)
                || tick["multiplayer_map_name"].as_str() != Some(map)
            {
                return Err("decoded timeline or map is inconsistent".into());
            }
            if stride == 4 || tick_count.is_multiple_of(4) {
                if stride == 1 {
                    crate::sampling::normalize(&mut tick, tick_count, 4, map)?;
                }
                selected_hash.update(semantic_value_digest(&tick)?);
            }
            if let Some(next) = next {
                before_previous = previous.replace(next);
            }
            tick_count += 1;
        }
        if !pose_codec && (reader.offset != raw.len() || tick_hash.finish() != chunk.tick_sha256) {
            return Err("decoded tick hash or chunk trailing bytes differ".into());
        }
        total_raw += raw.len() as u64;
        if total_raw > MAX_UNCOMPRESSED_BYTES {
            return Err("uncompressed replay exceeds contract limit".into());
        }
        offset += chunk.compressed_bytes as u64;
    }
    if tick_count != manifest.tick_count || chunks_start + offset != size {
        return Err("artifact has gaps or trailing data".into());
    }
    Ok(Scan {
        manifest,
        selected_hash: digest_hex(selected_hash.finalize()),
        file_hash: sha256_file(path)?,
        bytes: size,
    })
}

pub fn validate_file(path: &Path) -> Result<Value, Box<dyn Error>> {
    let result = scan(path, 1)?;
    Ok(
        serde_json::json!({"status":"verified", "sha256":result.file_hash,
        "tick_count":result.manifest.tick_count, "size_bytes":result.bytes}),
    )
}

pub fn verify_pair(high_path: &Path, low_path: &Path) -> Result<Value, Box<dyn Error>> {
    let high = scan(high_path, 1)?;
    let low = scan(low_path, 4)?;
    if low.manifest.tick_count != high.manifest.tick_count.div_ceil(4)
        || low.selected_hash != high.selected_hash
        || low.manifest.recorded_at != high.manifest.recorded_at
        || high.manifest.replay_id.strip_suffix("-120hz").is_none()
        || high.manifest.replay_id.strip_suffix("-120hz")
            != low.manifest.replay_id.strip_suffix("-30hz")
    {
        return Err(
            "30 Hz states differ from unit-normalized every-fourth samples of the 120 Hz replay"
                .into(),
        );
    }
    let high_duration = high.manifest.tick_count as f64 / 120.0;
    for replay in [&high.manifest.replay, &low.manifest.replay] {
        if replay
            .get("summary")
            .and_then(|v| v.get("recording_duration"))
            .and_then(number)
            != Some(high_duration)
        {
            return Err("recording duration does not match the source tick count".into());
        }
    }
    let mut resampled_metadata = high.manifest.replay.clone();
    crate::sampling::retime_metadata(&mut resampled_metadata, 4, low.manifest.tick_count)?;
    for key in ["game_meta", "events"] {
        if resampled_metadata.get(key) != low.manifest.replay.get(key) {
            return Err("dual-rate metadata differs after timeline conversion".into());
        }
    }
    Ok(
        serde_json::json!({"status":"verified", "every_fourth_state_exact_after_unit_conversion":true,
        "120hz":{"ticks":high.manifest.tick_count,"chunks":high.manifest.chunks.len(),"sha256":high.file_hash,"bytes":high.bytes},
        "30hz":{"ticks":low.manifest.tick_count,"chunks":low.manifest.chunks.len(),"sha256":low.file_hash,"bytes":low.bytes},
        "duration_seconds":high_duration,"sampled_state_sha256":high.selected_hash}),
    )
}

#[cfg(test)]
mod incremental_tests {
    use super::*;
    #[test]
    fn encoding_worker_propagates_errors_and_never_publishes_partial_streams() {
        let root = std::env::temp_dir().join(format!(
            "h1-worker-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        for (name, ticks, expected) in [
            (
                "invalid",
                vec![serde_json::json!({"players":"wrong"}); 9],
                9,
            ),
            ("short", vec![serde_json::json!({}); 7], 8),
            ("long", vec![serde_json::json!({}); 9], 8),
        ] {
            let mut worker = EncodingWorker::new(&root.join(name), expected, 1).unwrap();
            let output = root.join(format!("{name}.hsrdc"));
            for tick in ticks {
                worker.push_owned(tick).unwrap();
            }
            assert!(
                worker
                    .finish(&Map::new(), &output, "test", "2026-10-08T00:00:00Z")
                    .is_err()
            );
            assert!(!output.exists());
        }
        assert!(root.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn owned_projection_matches_borrowed_contracts_and_rejects_invalid_values() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../replay_parser/tests/fixtures/replays/viewer_v2_first_person_canonical.json"
        ))
        .unwrap();
        let mut inputs = fixture["ticks"].as_array().unwrap().clone();
        inputs.extend([
            serde_json::json!({"players":[{"name":null,"player_object_data":null,"model_nodes":[[1,2,3,4,5,6,7,8,9,10,11,12,13,14]]}],"unknown":{"deep":[1]}}),
            serde_json::json!({"game_meta":{"players":{"9":null,"1":{"name":"A"},"0":{"name":"B"}}}}),
            serde_json::json!({"players":"wrong"}),
            serde_json::json!({"players":[{"name":{}}]}),
            serde_json::json!({"players":[{"model_nodes":[[null]]}]}),
            serde_json::json!({"players":vec![serde_json::json!({});65]}),
            Value::Null,
        ]);
        for revision in [1, 2, 3, 4] {
            let projection = Projection::load_revision(revision).unwrap();
            let mut recycled = Value::Null;
            for input in inputs.iter().cycle().take(inputs.len() * 3) {
                let expected = projection.tick.project(input);
                let actual = projection.tick.project_owned(input.clone());
                let reused = projection.tick.project_reusing(input, &mut recycled);
                assert_eq!(reused.is_ok(), expected.is_ok());
                assert_eq!(actual.is_ok(), expected.is_ok());
                if let (Ok(actual), Ok(expected)) = (actual, expected) {
                    assert!(deep_exact_equal(&actual, &expected));
                    assert_eq!(
                        serde_json::to_vec(&actual).unwrap(),
                        serde_json::to_vec(&expected).unwrap()
                    );
                    assert_eq!(
                        serde_json::to_vec(&recycled).unwrap(),
                        serde_json::to_vec(&expected).unwrap()
                    );
                }
            }
        }
        let node = compile_projection(
            &Map::new(),
            &Map::new(),
            &serde_json::json!({
                "kind":"object","required":["before"],
                "fields":{"after":{"kind":"array","source":"before","max_items":3,"items":"scalar"}}
            }),
            0,
        )
        .unwrap();
        for input in [
            serde_json::json!({"before":[1,-0.0]}),
            serde_json::json!({}),
            serde_json::json!({"before":null}),
        ] {
            let expected = node.project(&input);
            let actual = node.project_owned(input.clone());
            let mut recycled = serde_json::json!({"after":[false, 0.0]});
            assert_eq!(
                node.project_reusing(&input, &mut recycled).is_ok(),
                expected.is_ok()
            );
            assert_eq!(actual.is_ok(), expected.is_ok());
            if let (Ok(actual), Ok(expected)) = (actual, expected) {
                assert!(deep_exact_equal(&actual, &expected));
            }
        }
    }
    #[test]
    fn batch_and_incremental_bytes_match() {
        let ticks = vec![
            serde_json::json!({"p":[{"id":4294901761_u64,"v":[-0.0,2.0],"gone":true}]}),
            serde_json::json!({"p":[{"id":4294901761_u64,"v":[1.75,2.5]}]}),
            serde_json::json!({"p":[{"id":4294901761_u64,"v":[2.0,3.0],"new":null}]}),
            serde_json::json!({"p":[]}),
        ];
        let expected = encode_chunk(&ticks, 2048).unwrap();
        let expected_hash = decode_chunk_semantic_hash(&expected).unwrap().tick_sha256;
        let mut stream = IncrementalChunk::new(2048, ticks.len()).unwrap();
        for tick in ticks {
            stream.push(tick).unwrap();
        }
        assert_eq!(stream.binary.bytes, expected);
        assert_eq!(stream.tick_hash.finish(), expected_hash);
    }

    #[test]
    fn inline_validation_rejects_wrong_values_types_signed_zero_and_trailing_bytes() {
        let source =
            serde_json::json!({"x":-0.0,"text":"value","array":[null,true,4294901761_u64]});
        let mut binary = BinaryWriter::new();
        write_value(&mut binary, &source).unwrap();
        assert!(verify_tick(&binary.bytes, &source, None, None, &mut Vec::new()).is_ok());
        for (key, wrong) in [
            ("x", serde_json::json!(0.0)),
            ("text", serde_json::json!(null)),
            ("array", serde_json::json!([null, true, 4294901762_u64])),
        ] {
            let mut different = source.clone();
            different[key] = wrong;
            assert!(verify_tick(&binary.bytes, &different, None, None, &mut Vec::new()).is_err());
        }
        binary.bytes.push(0);
        assert!(verify_tick(&binary.bytes, &source, None, None, &mut Vec::new()).is_err());
    }

    #[test]
    fn inline_validation_matches_independent_decoder_across_optional_fields_and_predictions() {
        let mut stream = IncrementalChunk::new(0, 257).unwrap();
        let mut ticks = Vec::new();
        for index in 0..257 {
            let mut tick = serde_json::json!({"first":index, "optional":null,
                "nodes":[index as f32 * 0.125, -0.0, (index as f32).sin()],
                "last":["repeat", "string", index % 7 == 0]});
            if index % 3 == 0 {
                tick.as_object_mut().unwrap().shift_remove("optional");
            }
            stream.push(tick.clone()).unwrap();
            ticks.push(tick);
        }
        let expected = encode_chunk(&ticks, 0).unwrap();
        assert_eq!(stream.binary.bytes, expected);
        assert_eq!(
            stream.tick_hash.finish(),
            decode_chunk_semantic_hash(&expected).unwrap().tick_sha256
        );
    }

    fn pair(directory: &Path, count: usize, altered: bool) {
        fs::create_dir(directory).unwrap();
        let mut high = EncodingWorker::new(&directory.join("parts-high"), count, 6).unwrap();
        let mut low =
            StreamingExport::new(&directory.join("parts-low"), count.div_ceil(4), 6).unwrap();
        for index in 0..count {
            let mut tick = serde_json::json!({"current_tick":index,"current_game_time_seconds":index as f64/120.0,
                "game_time_info":{"game_time":index,"real_time_elapsed":"0:00:00"},
                "players":[{"player_index":0,"name":"test","respawn_timer":7,
                    "player_object_id":4294901761_u64, "player_object_data":null}],
                "objects":[],"game_type":2});
            crate::sampling::normalize(&mut tick, index, 1, "downrush").unwrap();
            high.push_owned(tick.clone()).unwrap();
            if index.is_multiple_of(4) {
                crate::sampling::normalize(&mut tick, index, 4, "downrush").unwrap();
                if altered {
                    tick["players"][0]["respawn_timer"] = serde_json::json!(8);
                }
                low.push_owned(tick).unwrap();
            }
        }
        let metadata = |ticks| {
            serde_json::json!({"summary":{"ticks_recorded":ticks,
                "recording_duration":count as f64/120.0,"ticks_dropped":0},
                "game_meta":{"map_name":"downrush"},"events":[]})
            .as_object()
            .unwrap()
            .clone()
        };
        high.finish(
            &metadata(count),
            &directory.join("high.hsrdc"),
            "test-120hz",
            "2026-09-30T00:00:00Z",
        )
        .unwrap();
        low.finish(
            &metadata(count.div_ceil(4)),
            &directory.join("low.hsrdc"),
            "test-30hz",
            "2026-09-30T00:00:00Z",
        )
        .unwrap();
    }

    #[test]
    fn full_containers_validate_boundaries_and_reject_damage() {
        let root = std::env::temp_dir().join(format!(
            "h1-film-codec-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        for count in [1, 3, 4, 5, 2047, 2048, 2049, 8193] {
            let directory = root.join(count.to_string());
            pair(&directory, count, false);
            let high = directory.join("high.hsrdc");
            let low = directory.join("low.hsrdc");
            assert!(verify_pair(&high, &low).is_ok(), "count={count}");
            let mut bytes = fs::read(&low).unwrap();
            let end = bytes.len() - 1;
            bytes[end] ^= 1;
            fs::write(&low, &bytes).unwrap();
            assert!(verify_pair(&high, &low).is_err());
            fs::write(&low, &bytes[..31]).unwrap();
            assert!(verify_pair(&high, &low).is_err());
        }
        let altered = root.join("altered");
        pair(&altered, 5, true);
        assert!(verify_pair(&altered.join("high.hsrdc"), &altered.join("low.hsrdc")).is_err());
        assert!(root.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(root).unwrap();
    }
}
