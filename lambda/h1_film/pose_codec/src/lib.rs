pub mod pose;
pub mod wire;

pub const MAX_PLAYERS: usize = 16;

use serde_json::Value;
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

pub trait BaseCodec {
    fn encode(&self, ticks: &[Value], first: usize) -> Result<Vec<u8>>;
    fn decode(&self, bytes: &[u8]) -> Result<(usize, Vec<Value>)>;
}

pub fn settings() -> pose::Settings {
    pose::Settings::preset("local3-fine").expect("fixed codec settings")
}

// This is a prediction tree, not a dependency on a map's render skeleton.
// Unknown tags/counts stay in the lossless base stream; every coded pose is bounded.
pub fn skeletons() -> Vec<pose::Skeleton> {
    [
        "characters\\cyborg_mp\\cyborg_mp",
        "characters\\cyborg\\cyborg",
    ]
    .into_iter()
    .map(|tag| pose::Skeleton {
        tag: tag.into(),
        parents: vec![
            -1, 0, 0, 0, 1, 2, 3, 6, 4, 6, 6, 5, 9, 7, 10, 13, 14, 15, 16,
        ],
        names: Vec::new(),
        source_glb_sha256: String::new(),
        model_path: String::new(),
    })
    .collect()
}

pub fn verify(source: &[Value], decoded: &mut [Value]) -> Result<pose::ErrorStats> {
    if source.len() != decoded.len() {
        return Err("pose tick count changed".into());
    }
    let mut errors = pose::ErrorStats::default();
    for (source, decoded) in source.iter().zip(decoded) {
        if source["players"].as_array().map(Vec::len) != decoded["players"].as_array().map(Vec::len)
        {
            return Err("pose player count changed".into());
        }
        for (a, b) in source["players"]
            .as_array()
            .ok_or("players missing")?
            .iter()
            .zip(decoded["players"].as_array_mut().ok_or("players missing")?)
        {
            if let Some(original) = a.get("model_nodes")
                && let Some(restored) = b.get("model_nodes")
            {
                if legacy::equal(original, restored) {
                    continue;
                }
                let before = pose::read_pose(original)?;
                let after = pose::read_pose(restored)?;
                errors.observe(&before, &after, settings().point_radius)?;
                if before.iter().zip(&after).any(|(a, b)| {
                    let bound = pose::point_bound(a, b, settings().point_radius);
                    !bound.is_finite() || bound > settings().point_error_limit
                }) {
                    return Err("pose error exceeds contract bound".into());
                }
                b["model_nodes"] = original.clone();
            }
        }
        if !legacy::equal(source, decoded) {
            return Err("non-pose values changed".into());
        }
    }
    Ok(errors)
}

mod legacy {
    pub use crate::Result;
    use serde_json::Value;

    pub fn equal(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Object(a), Value::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .all(|(k, v)| b.get(k).is_some_and(|other| equal(v, other)))
            }
            (Value::Array(a), Value::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
            }
            (Value::Number(a), Value::Number(b)) => {
                a.as_f64().map(f64::to_bits) == b.as_f64().map(f64::to_bits)
            }
            _ => a == b,
        }
    }

    pub fn compress(raw: &[u8]) -> Result<Vec<u8>> {
        if raw.len() > 64 * 1024 * 1024 {
            return Err("block too large".into());
        }
        let mut c = zstd::bulk::Compressor::new(6)?;
        c.include_checksum(true)?;
        c.include_contentsize(true)?;
        let packed = c.compress(raw)?;
        if decompress(&packed, raw.len())? != raw {
            return Err("pose compression round trip changed bytes".into());
        }
        Ok(packed)
    }

    pub fn decompress(packed: &[u8], size: usize) -> Result<Vec<u8>> {
        if size > 64 * 1024 * 1024 {
            return Err("block too large".into());
        }
        let raw = zstd::bulk::decompress(packed, size)?;
        if raw.len() != size {
            return Err("block size mismatch".into());
        }
        Ok(raw)
    }
}
