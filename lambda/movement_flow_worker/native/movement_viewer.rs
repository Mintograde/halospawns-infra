// Included alongside the authoritative delta reader in the movement-only binary.
fn movement_number(object: &DecodedValue, key: &str) -> Option<f64> {
    let v = object.as_object()?.get(key)?;
    match v {
        DecodedValue::String(s) => crate::object_number(s).map(|n| n as f64),
        _ => v.number(),
    }
}
fn movement_points(tick: &DecodedValue) -> [Option<crate::Point>; crate::SLOTS] {
    let mut points = [None; crate::SLOTS];
    let players = tick
        .as_object()
        .and_then(|t| t.get("players"))
        .and_then(DecodedValue::as_array)
        .unwrap_or_default();
    for player in players {
        let Some(p) = player.as_object() else {
            continue;
        };
        let Some(body) = p.get("player_object_data") else {
            continue;
        };
        let identity = movement_number(player, "object_ref")
            .or_else(|| movement_number(player, "player_object_id"))
            .or_else(|| movement_number(body, "object_id"));
        let hostman = p
            .get("derived_stats")
            .and_then(DecodedValue::as_object)
            .is_some_and(|s| matches!(s.get("is_hostman"), Some(DecodedValue::Bool(true))));
        if let Some((slot, point)) = crate::position(
            movement_number(player, "player_index").map(|v| v as i64),
            identity.map(|v| v as i64),
            ["x", "y", "z"].map(|k| movement_number(body, k)),
            movement_number(body, "health"),
            hostman,
        ) {
            points[slot] = Some(point);
        }
    }
    points
}
pub(super) fn movement_world(
    file: &mut BufReader<File>,
    field: &mut crate::Field,
    expected: usize,
) -> crate::Result<()> {
    let mut header = [0u8; 32];
    file.read_exact(&mut header)?;
    let u32_at = |i| u32::from_le_bytes(header[i..i + 4].try_into().unwrap()) as usize;
    let pose = &header[..8] == b"HSRDC002";
    if (!pose && &header[..8] != b"HSRDC001")
        || u32_at(12) != 1
        || u32_at(24) as u64 != file.get_ref().metadata()?.len()
        || !(1..=16 << 20).contains(&u32_at(16))
        || !(1..=64 << 20).contains(&u32_at(20))
    {
        return Err("invalid viewer header".into());
    }
    let mut packed = vec![0; u32_at(16)];
    file.read_exact(&mut packed)?;
    let raw = zstd::bulk::decompress(&packed, u32_at(20))?;
    let manifest: ViewerManifest = serde_json::from_slice(&raw)?;
    manifest.source_contract.validate(manifest.tick_count)?;
    if manifest.tick_count != expected
        || expected > crate::MAX_FRAMES
        || manifest.keyframe_interval != KEYFRAME_INTERVAL
    {
        return Err("invalid viewer timeline".into());
    }
    let mut offset = 0;
    for chunk in manifest.chunks {
        if chunk.offset != offset
            || chunk.first_tick != field.frames
            || !(1..=2048).contains(&chunk.tick_count)
            || !(1..=64 << 20).contains(&chunk.raw_bytes)
            || !(1..=64 << 20).contains(&chunk.compressed_bytes)
        {
            return Err("invalid viewer chunk".into());
        }
        packed.resize(chunk.compressed_bytes, 0);
        file.read_exact(&mut packed)?;
        if sha256_hex(&packed) != chunk.compressed_sha256 {
            return Err("viewer chunk hash mismatch".into());
        }
        let raw = zstd::bulk::decompress(&packed, chunk.raw_bytes)?;
        if raw.len() != chunk.raw_bytes {
            return Err("invalid viewer chunk size".into());
        }
        let base = if pose {
            if raw.len() < 20 || &raw[..4] != b"PC01" {
                return Err("invalid pose envelope".into());
            }
            let n = |i| u32::from_le_bytes(raw[i..i + 4].try_into().unwrap()) as usize;
            if !(1..=64 << 20).contains(&n(4)) || 20 + n(8) + n(16) != raw.len() {
                return Err("invalid pose streams".into());
            }
            // Only decode the lossless player state. Bone matrices never enter the field.
            let base = zstd::bulk::decompress(&raw[20..20 + n(8)], n(4))?;
            if base.len() != n(4) {
                return Err("invalid base stream size".into());
            }
            base
        } else {
            raw
        };
        let mut reader = BinaryReader::new(&base);
        if reader.bytes(4)? != CHUNK_MAGIC
            || reader.byte()? != CHUNK_VERSION
            || reader.varuint()? != chunk.first_tick as u64
            || reader.varuint()? != chunk.tick_count as u64
        {
            return Err("invalid delta timeline".into());
        }
        let (mut previous, mut before) = (None, None);
        for _ in 0..chunk.tick_count {
            let tick = if previous.is_none() {
                read_value(&mut reader, 1)?
            } else {
                read_patched_value(&mut reader, previous.as_ref(), before.as_ref(), 1)?
            };
            let clock = tick
                .as_object()
                .and_then(|o| o.get("game_time_info"))
                .and_then(|o| movement_number(o, "game_time"))
                .or_else(|| movement_number(&tick, "current_tick"));
            let ended = tick.as_object().is_some_and(|o| {
                matches!(
                    o.get("game_ended_this_tick"),
                    Some(DecodedValue::Bool(true))
                )
            });
            field.frame(clock.map(|v| v as i64), ended, movement_points(&tick))?;
            before = previous.replace(tick);
        }
        if reader.offset != base.len() {
            return Err("trailing delta bytes".into());
        }
        offset += chunk.compressed_bytes as u64;
    }
    if field.frames != expected || 32 + u32_at(16) as u64 + offset != u32_at(24) as u64 {
        return Err("incomplete viewer world".into());
    }
    Ok(())
}
