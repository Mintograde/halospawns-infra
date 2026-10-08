// The existing projection, schema validators, delta codec and finalizer stay authoritative.
#![allow(dead_code)]
include!("../../../replay_parser/native/src/viewer.rs");

const LOCAL_CHUNK_RAW_LIMIT: usize = 64 * 1024 * 1024;

// Moving whole tick trees between threads increased CPU use in the constrained
// static-glibc build. Windows benefits from the additional bounded pipeline.
#[cfg(windows)]
pub type PrimaryExport = EncodingWorker;
#[cfg(not(windows))]
pub type PrimaryExport = StreamingExport;

impl CompiledProjection {
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
        })
    }
    fn push(&mut self, next: Value) -> Result<(), Box<dyn Error>> {
        if self.previous.is_none() {
            write_value(&mut self.binary, &next)?;
        } else {
            write_delta(
                &mut self.binary,
                self.previous.as_ref(),
                &next,
                self.before_previous.as_ref(),
            )?;
        }
        self.before_previous = self.previous.replace(next);
        if self.binary.bytes.len() > LOCAL_CHUNK_RAW_LIMIT {
            return Err("chunk exceeds the local 64 MiB raw-memory budget".into());
        }
        Ok(())
    }
}

fn local_collector(directory: &Path, level: i32) -> Result<ViewerWriter, Box<dyn Error>> {
    fs::create_dir(directory)?;
    projection()?;
    let (sender, receiver) = mpsc::sync_channel::<ChunkTask>(1);
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
                let result = process_chunk(
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
    Ok(ViewerWriter {
        directory: directory.to_owned(),
        task_sender: Some(sender),
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
    })
}

pub struct StreamingExport {
    collector: ViewerWriter,
    chunk: Option<IncrementalChunk>,
    digests: Vec<[u8; 32]>,
    expected: usize,
    encode_duration: Duration,
}
impl StreamingExport {
    pub fn new(directory: &Path, expected: usize, level: i32) -> Result<Self, Box<dyn Error>> {
        if !(1..=MAX_TICKS).contains(&expected) || !(1..=19).contains(&level) {
            return Err("invalid tick count or compression level".into());
        }
        Ok(Self {
            collector: local_collector(directory, level)?,
            chunk: None,
            digests: Vec::with_capacity(KEYFRAME_INTERVAL),
            expected,
            encode_duration: Duration::ZERO,
        })
    }
    pub fn push(&mut self, source: &Value) -> Result<(), Box<dyn Error>> {
        let (projected, digest, duration) = project_tick(source)?;
        self.push_projected(projected, digest, duration)
    }
    pub fn push_owned(&mut self, source: Value) -> Result<(), Box<dyn Error>> {
        let started = Instant::now();
        validate_json_safety(&source, 3)?;
        let projected = projection()?.tick.project_owned(source)?;
        if !projection()?.tick_validator.is_valid(&projected) {
            return Err("viewer tick violates its closed schema".into());
        }
        let digest = semantic_value_digest(&projected)?;
        self.push_projected(projected, digest, started.elapsed())
    }
    fn push_projected(
        &mut self,
        projected: Value,
        digest: [u8; 32],
        duration: Duration,
    ) -> Result<(), Box<dyn Error>> {
        if self.collector.tick_count >= self.expected {
            return Err("too many source ticks".into());
        }
        self.collector.projection_duration += duration;
        let started = Instant::now();
        if self.chunk.is_none() {
            let first = self.collector.tick_count;
            self.chunk = Some(IncrementalChunk::new(
                first,
                KEYFRAME_INTERVAL.min(self.expected - first),
            )?);
        }
        self.chunk.as_mut().unwrap().push(projected)?;
        self.digests.push(digest);
        self.collector.tick_count += 1;
        self.encode_duration += started.elapsed();
        if self.digests.len() == KEYFRAME_INTERVAL || self.collector.tick_count == self.expected {
            let raw = self.chunk.take().unwrap().binary.bytes;
            self.collector.raw_chunk_bytes += raw.len() as u64;
            if self.collector.raw_chunk_bytes > MAX_UNCOMPRESSED_BYTES {
                return Err("raw replay exceeds contract limit".into());
            }
            self.collector
                .task_sender
                .as_ref()
                .unwrap()
                .send(ChunkTask {
                    directory: self.collector.directory.clone(),
                    index: self.collector.dispatched_chunks,
                    first_tick: self.collector.tick_count - self.digests.len(),
                    tick_count: self.digests.len(),
                    raw,
                    expected_semantic_sha256: semantic_tick_hash(&self.digests),
                })
                .map_err(|_| "compression worker closed")?;
            self.digests.clear();
            self.collector.dispatched_chunks += 1;
            self.collector.collect_ready_results()?;
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
        if self.collector.tick_count != self.expected || self.chunk.is_some() {
            return Err("incomplete tick stream".into());
        }
        self.collector.encode_duration_ms = self.encode_duration.as_millis();
        self.collector.finish(metadata)?;
        let directory = &self.collector.directory;
        let parts: PartsDescriptor =
            serde_json::from_reader(BufReader::new(File::open(directory.join("parts.json"))?))?;
        let mut offset = 0;
        let chunks: Vec<_> = parts.chunks.iter().map(|part| {
            let chunk = serde_json::json!({"index":part.index, "firstTick":part.first_tick,
                "tickCount":part.tick_count, "offset":offset, "compressedBytes":part.compressed_bytes,
                "rawBytes":part.raw_bytes, "compressedSha256":part.compressed_sha256, "tickSha256":part.tick_sha256});
            offset += part.compressed_bytes;
            chunk
        }).collect();
        let manifest = serde_json::json!({"format":VIEWER_DELTA_FORMAT, "sourceContract":parts.source_contract,
            "replayId":replay_id, "recordedAt":recorded_at, "keyframeInterval":KEYFRAME_INTERVAL,
            "tickCount":parts.tick_count, "chunks":chunks, "replay":parts.replay});
        let path = directory.join("manifest.json");
        fs::write(&path, serde_json::to_vec(&manifest)?)?;
        finalize_container(directory, &path, output)
    }
}

impl Drop for StreamingExport {
    fn drop(&mut self) {
        self.collector.task_sender.take();
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
    if &header[..8] != CONTAINER_MAGIC
        || header[8..12] != [32, 0, 1, 0]
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
    let schema: Value = serde_json::from_str(include_str!(
        "../../../replay_parser/contracts/replays/halospawns.viewerReplayDelta.v1.frontend-default.v2.manifest.schema.json"
    ))?;
    if !jsonschema::validator_for(&schema)?.is_valid(&value) {
        return Err("manifest violates the revision-2 schema".into());
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
    // Every chunk starts cold. Retain two decoded ticks, never a match or a whole chunk's tree.
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
        if reader.bytes(4)? != CHUNK_MAGIC
            || reader.byte()? != CHUNK_VERSION
            || reader.varuint()? != chunk.first_tick as u64
            || reader.varuint()? != chunk.tick_count as u64
        {
            return Err("chunk header differs from manifest".into());
        }
        let mut previous = None;
        let mut before_previous = None;
        let mut tick_hash = TickHasher::new();
        for _ in 0..chunk.tick_count {
            let next = if previous.is_none() {
                read_value(&mut reader, 1)?
            } else {
                read_patched_value(&mut reader, previous.as_ref(), before_previous.as_ref(), 1)?
            };
            tick_hash.update(&next)?;
            let mut tick = owned_json(&next)?;
            if !projection()?.tick_validator.is_valid(&tick) {
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
            before_previous = previous.replace(next);
            tick_count += 1;
        }
        if reader.offset != raw.len() || tick_hash.finish() != chunk.tick_sha256 {
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
        for revision in [1, 2] {
            let projection = Projection::load_revision(revision).unwrap();
            for input in &inputs {
                let expected = projection.tick.project(input);
                let actual = projection.tick.project_owned(input.clone());
                assert_eq!(actual.is_ok(), expected.is_ok());
                if let (Ok(actual), Ok(expected)) = (actual, expected) {
                    assert!(deep_exact_equal(&actual, &expected));
                    assert_eq!(
                        serde_json::to_vec(&actual).unwrap(),
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
            let actual = node.project_owned(input);
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
        let mut stream = IncrementalChunk::new(2048, ticks.len()).unwrap();
        for tick in ticks {
            stream.push(tick).unwrap();
        }
        assert_eq!(stream.binary.bytes, expected);
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
