// Measurement only: no modified replay artifacts are written.
#![allow(dead_code)]
include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../replay_parser/native/src/viewer.rs"
));
use std::collections::BTreeMap;
use std::io::{Seek, SeekFrom};

#[derive(Clone, Copy)]
enum Removal {
    None,
    Root(&'static str),
    Player(&'static str),
    PlayerScalars,
    Inventory,
    Globals,
}

const VARIANTS: &[(&str, Removal)] = &[
    ("baseline", Removal::None),
    ("players", Removal::Root("players")),
    ("players[].model_nodes", Removal::Player("model_nodes")),
    (
        "players[].player_object_data",
        Removal::Player("player_object_data"),
    ),
    ("players[].player_object_data.weapons", Removal::Inventory),
    (
        "players[].first_person_weapon",
        Removal::Player("first_person_weapon"),
    ),
    ("players[].identity_scores_timers", Removal::PlayerScalars),
    ("objects", Removal::Root("objects")),
    ("game_meta", Removal::Root("game_meta")),
    ("spawns", Removal::Root("spawns")),
    ("network_game_object", Removal::Root("network_game_object")),
    ("clocks_and_other_root_scalars", Removal::Globals),
];

fn profile_json(value: &DecodedValue) -> Result<Value, Box<dyn Error>> {
    Ok(match value {
        DecodedValue::Null => Value::Null,
        DecodedValue::Bool(v) => Value::Bool(*v),
        DecodedValue::Number(v) => Value::Number(Number::from_f64(*v).ok_or("nonfinite number")?),
        DecodedValue::String(v) => Value::String(v.to_string()),
        DecodedValue::Array(v) => {
            Value::Array(v.iter().map(profile_json).collect::<Result<_, _>>()?)
        }
        DecodedValue::Object(v) => Value::Object(
            v.iter()
                .map(|(k, v)| Ok((k.to_string(), profile_json(v)?)))
                .collect::<Result<_, Box<dyn Error>>>()?,
        ),
    })
}

fn profile_decode(raw: &[u8]) -> Result<(usize, Vec<Value>), Box<dyn Error>> {
    let mut reader = BinaryReader::new(raw);
    if reader.bytes(4)? != CHUNK_MAGIC || reader.byte()? != CHUNK_VERSION {
        return Err("unsupported chunk".into());
    }
    let first = usize::try_from(reader.varuint()?)?;
    let count = usize::try_from(reader.varuint()?)?;
    if !(1..=KEYFRAME_INTERVAL).contains(&count) {
        return Err("invalid chunk count".into());
    }
    let mut previous = None;
    let mut before_previous = None;
    let mut ticks = Vec::with_capacity(count);
    for index in 0..count {
        let next = if index == 0 {
            read_value(&mut reader, 1)?
        } else {
            read_patched_value(&mut reader, previous.as_ref(), before_previous.as_ref(), 1)?
        };
        // Patches retain insertion order; the producer reprojects every tick into
        // contract field order before encoding, including fields restored on respawn.
        ticks.push(projection()?.tick.project(&profile_json(&next)?)?);
        before_previous = previous.replace(next);
    }
    if reader.offset != raw.len() {
        return Err("trailing chunk bytes".into());
    }
    Ok((first, ticks))
}

fn remove_fields(tick: &mut Value, removal: Removal) {
    let root = tick.as_object_mut().unwrap();
    match removal {
        Removal::None => {}
        Removal::Root(key) => {
            root.shift_remove(key);
        }
        Removal::Globals => {
            root.retain(|key, _| {
                matches!(
                    key.as_str(),
                    "players" | "objects" | "game_meta" | "spawns" | "network_game_object"
                )
            });
        }
        _ => {
            for player in root.get_mut("players").unwrap().as_array_mut().unwrap() {
                let player = player.as_object_mut().unwrap();
                match removal {
                    Removal::Player(key) => {
                        player.shift_remove(key);
                    }
                    Removal::PlayerScalars => player.retain(|key, _| {
                        matches!(
                            key.as_str(),
                            "model_nodes" | "player_object_data" | "first_person_weapon"
                        )
                    }),
                    Removal::Inventory => {
                        if let Some(body) = player
                            .get_mut("player_object_data")
                            .and_then(Value::as_object_mut)
                        {
                            body.shift_remove("weapons");
                        }
                    }
                    _ => unreachable!(),
                }
            }
        }
    }
}

fn encode_variant(
    ticks: &[Value],
    first: usize,
    removal: Removal,
) -> Result<Vec<u8>, Box<dyn Error>> {
    if matches!(removal, Removal::None) {
        return encode_chunk(ticks, first);
    }
    let mut writer = BinaryWriter::new();
    writer.bytes(CHUNK_MAGIC);
    writer.byte(CHUNK_VERSION);
    writer.varuint(first as u64)?;
    writer.varuint(ticks.len() as u64)?;
    let mut previous = None;
    let mut before_previous = None;
    for tick in ticks {
        let mut next = tick.clone();
        remove_fields(&mut next, removal);
        if previous.is_none() {
            write_value(&mut writer, &next)?;
        } else {
            write_delta(
                &mut writer,
                previous.as_ref(),
                &next,
                before_previous.as_ref(),
            )?;
        }
        before_previous = previous.replace(next);
    }
    Ok(writer.bytes)
}

#[derive(Default, Serialize)]
struct ValueStats {
    values: u64,
    json_value_bytes: u64,
    array_elements: u64,
    maximum_array_length: usize,
}

fn observe(
    stats: &mut BTreeMap<String, ValueStats>,
    path: String,
    value: &Value,
) -> Result<(), Box<dyn Error>> {
    let entry = stats.entry(path).or_default();
    entry.values += 1;
    entry.json_value_bytes += serde_json::to_vec(value)?.len() as u64;
    if let Some(array) = value.as_array() {
        entry.array_elements += array.len() as u64;
        entry.maximum_array_length = entry.maximum_array_length.max(array.len());
    }
    Ok(())
}

fn profile_file(path: &Path) -> Result<Value, Box<dyn Error>> {
    let started = Instant::now();
    let digest = sha256_file(path)?;
    let mut input = File::open(path)?;
    let file_bytes = input.metadata()?.len();
    let mut header = [0_u8; 32];
    input.read_exact(&mut header)?;
    let u32_at = |start| u32::from_le_bytes(header[start..start + 4].try_into().unwrap()) as usize;
    if &header[..8] != CONTAINER_MAGIC || u32_at(24) as u64 != file_bytes {
        return Err("invalid container".into());
    }
    let mut packed_manifest = vec![0; u32_at(16)];
    input.read_exact(&mut packed_manifest)?;
    let manifest_raw = zstd::bulk::decompress(&packed_manifest, u32_at(20))?;
    let manifest_value: Value = serde_json::from_slice(&manifest_raw)?;
    let manifest: ViewerManifest = serde_json::from_value(manifest_value.clone())?;
    manifest.source_contract.validate(manifest.tick_count)?;
    let mut metadata = BTreeMap::new();
    for (key, value) in manifest_value.as_object().unwrap() {
        observe(&mut metadata, format!("manifest.{key}"), value)?;
    }
    for (key, value) in &manifest.replay {
        observe(&mut metadata, format!("manifest.replay.{key}"), value)?;
    }
    let mut raw_values = BTreeMap::new();
    let mut totals = vec![(0_u64, 0_u64); VARIANTS.len()];
    let mut json_tick_bytes = 0_u64;
    let mut ticks_seen = 0;
    let mut node_count_histogram = BTreeMap::<usize, u64>::new();
    let mut objects_by_type = BTreeMap::<i64, u64>::new();
    let mut chunk_rows = Vec::new();
    for (chunk_index, chunk) in manifest.chunks.iter().enumerate() {
        input.seek(SeekFrom::Start(
            32 + packed_manifest.len() as u64 + chunk.offset,
        ))?;
        let mut compressed = vec![0; chunk.compressed_bytes];
        input.read_exact(&mut compressed)?;
        if digest_hex(Sha256::digest(&compressed)) != chunk.compressed_sha256 {
            return Err("chunk checksum mismatch".into());
        }
        let raw = zstd::bulk::decompress(&compressed, chunk.raw_bytes)?;
        let (first, ticks) = profile_decode(&raw)?;
        if first != ticks_seen || ticks.len() != chunk.tick_count {
            return Err("chunk coverage mismatch".into());
        }
        for tick in &ticks {
            json_tick_bytes += serde_json::to_vec(tick)?.len() as u64;
            for (key, value) in tick.as_object().unwrap() {
                observe(&mut raw_values, key.to_owned(), value)?;
            }
            for player in tick["players"].as_array().unwrap() {
                for (key, value) in player.as_object().unwrap() {
                    observe(&mut raw_values, format!("players[].{key}"), value)?;
                }
                if let Some(body) = player["player_object_data"].as_object() {
                    for (key, value) in body {
                        observe(
                            &mut raw_values,
                            format!("players[].player_object_data.{key}"),
                            value,
                        )?;
                    }
                }
                if let Some(nodes) = player["model_nodes"].as_array() {
                    *node_count_histogram.entry(nodes.len()).or_default() += 1;
                }
            }
            for object in tick["objects"].as_array().unwrap() {
                *objects_by_type
                    .entry(
                        object["object_type"]
                            .as_f64()
                            .ok_or("missing object type")? as i64,
                    )
                    .or_default() += 1;
            }
        }
        let mut chunk_results = Vec::new();
        // Bounded native workers; only one source chunk and two transformed ticks per worker.
        for variants in VARIANTS.chunks(4) {
            let results = thread::scope(|scope| {
                let handles: Vec<_> = variants
                    .iter()
                    .map(|(name, removal)| {
                        let ticks = &ticks;
                        let original_raw = &raw;
                        let original_compressed = &compressed;
                        scope.spawn(move || -> Result<_, String> {
                            let work = || -> Result<_, Box<dyn Error>> {
                                let encoded = encode_variant(ticks, first, *removal)?;
                                let mut compressor = zstd::bulk::Compressor::new(6)?;
                                compressor.include_checksum(true)?;
                                compressor.include_contentsize(true)?;
                                let packed = compressor.compress(&encoded)?;
                            if matches!(removal, Removal::None) {
                                if &encoded != original_raw {
                                    let first = encoded.iter().zip(original_raw.iter()).position(|(a, b)| a != b);
                                    return Err(format!("baseline raw bytes differ at {first:?}: {} versus {} bytes", encoded.len(), original_raw.len()).into());
                                }
                                if &packed != original_compressed {
                                    return Err("baseline compressed bytes differ".into());
                                }
                                }
                                Ok((*name, encoded.len() as u64, packed.len() as u64))
                            };
                            work().map_err(|error| error.to_string())
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|handle| {
                        handle
                            .join()
                            .map_err(|_| "profiler worker panicked".to_owned())?
                    })
                    .collect::<Result<Vec<_>, String>>()
            })?;
            chunk_results.extend(results);
        }
        for (index, (_, raw, packed)) in chunk_results.iter().enumerate() {
            totals[index].0 += raw;
            totals[index].1 += packed;
        }
        ticks_seen += ticks.len();
        chunk_rows.push(serde_json::json!({"index":chunk_index, "first_tick":first, "ticks":ticks.len(),
            "variants":chunk_results.iter().map(|(name, raw, compressed)| serde_json::json!({"removed":name, "delta_bytes":raw, "compressed_bytes":compressed})).collect::<Vec<_>>() }));
        eprintln!(
            "{}: chunk {}/{} ({} ticks), {:.1}s",
            path.display(),
            chunk_index + 1,
            manifest.chunks.len(),
            ticks_seen,
            started.elapsed().as_secs_f64()
        );
    }
    if ticks_seen != manifest.tick_count
        || 32 + packed_manifest.len() as u64 + totals[0].1 != file_bytes
    {
        return Err("file accounting mismatch".into());
    }
    let baseline = totals[0];
    let variants: Vec<_> = VARIANTS.iter().zip(&totals).map(|((name, _), (raw, packed))| serde_json::json!({
        "removed":name, "delta_bytes":raw, "compressed_chunk_bytes":packed,
        "delta_bytes_saved":baseline.0 as i64 - *raw as i64,
        "compressed_bytes_saved":baseline.1 as i64 - *packed as i64,
        "percent_of_original_file":100.0 * (baseline.1 as f64 - *packed as f64) / file_bytes as f64,
        "size_with_original_manifest_bytes":32 + packed_manifest.len() as u64 + packed,
    })).collect();
    Ok(serde_json::json!({
        "path":path, "sha256":digest, "file_bytes":file_bytes, "ticks":ticks_seen, "chunks":manifest.chunks.len(),
        "header_bytes":32, "compressed_manifest_bytes":packed_manifest.len(), "raw_manifest_bytes":manifest_raw.len(),
        "raw_delta_bytes":baseline.0, "compressed_chunk_bytes":baseline.1, "reserialized_tick_json_bytes":json_tick_bytes,
        "baseline_reencode_byte_identical":true, "raw_value_statistics":raw_values, "metadata_value_statistics":metadata,
        "model_node_count_histogram":node_count_histogram, "object_frame_instances_by_type":objects_by_type,
        "ablations":variants, "chunk_measurements":chunk_rows, "wall_seconds":started.elapsed().as_secs_f64(),
    }))
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() < 2 {
        return Err("Usage: size_profile <new report.json> <file.hsrdc> [more files]".into());
    }
    let mut output = File::options()
        .write(true)
        .create_new(true)
        .open(&args[0])?;
    let mut reports = Vec::new();
    for path in &args[1..] {
        reports.push(profile_file(Path::new(path))?);
    }
    let report = serde_json::json!({
        "schema":"halospawns.replaySizeProfile.v1", "zstd_level":6, "chunk_ticks":2048,
        "method":"Every original chunk decoded and re-encoded using the existing codec. Baseline must reproduce raw and compressed bytes exactly. Each ablation independently removes a named field across all ticks, then re-encodes and recompresses. Savings cover chunk payload only; original manifest size is held constant. Parent and child rows overlap, and shared compression makes marginal savings non-additive. Reserialized JSON value sizes are not stored bytes. No modified replay is written.",
        "files":reports,
    });
    serde_json::to_writer_pretty(&mut output, &report)?;
    output.write_all(b"\n")?;
    eprintln!("Saved {}", args[0]);
    Ok(())
}
