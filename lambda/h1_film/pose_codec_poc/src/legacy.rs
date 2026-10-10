#![allow(dead_code)]
// The shared codec brings its own test module through include!.
#![allow(clippy::items_after_test_module)]
include!("../../../replay_parser/native/src/viewer.rs");
use std::io::{Seek, SeekFrom};

pub type Result<T, E = Box<dyn Error>> = std::result::Result<T, E>;
pub const MAX_BLOCK: usize = 64 * 1024 * 1024;

pub fn hash(bytes: &[u8]) -> String {
    digest_hex(Sha256::digest(bytes))
}
pub fn file_hash(path: &Path) -> Result<String> {
    sha256_file(path)
}
pub fn equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|other| equal(value, other)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        _ => deep_exact_equal(a, b),
    }
}
pub fn tick_hash(ticks: &[Value]) -> Result<String> {
    let digests = ticks
        .iter()
        .map(semantic_value_digest)
        .collect::<Result<Vec<_>>>()?;
    Ok(semantic_tick_hash(&digests))
}
#[cfg(test)]
pub fn test_manifest(tick_count: usize) -> Value {
    serde_json::json!({
        "format": VIEWER_DELTA_FORMAT,
        "sourceContract": {
            "schema": VIEWER_SCHEMA, "profile": VIEWER_PROFILE,
            "profile_revision": 3, "projection_sha256": VIEWER_PROJECTION_V3_SHA256,
            "tick_count": tick_count
        },
        "replayId": "pose-codec-test", "recordedAt": "2026-10-10T00:00:00Z",
        "keyframeInterval": KEYFRAME_INTERVAL, "tickCount": tick_count,
        "chunks": [], "replay": {}
    })
}
fn json(v: &DecodedValue) -> Result<Value> {
    Ok(match v {
        DecodedValue::Null => Value::Null,
        DecodedValue::Bool(v) => Value::Bool(*v),
        DecodedValue::Number(v) => Value::Number(Number::from_f64(*v).ok_or("nonfinite")?),
        DecodedValue::String(v) => Value::String(v.to_string()),
        DecodedValue::Array(v) => Value::Array(v.iter().map(json).collect::<Result<_>>()?),
        DecodedValue::Object(v) => Value::Object(
            v.iter()
                .map(|(k, v)| Ok((k.to_string(), json(v)?)))
                .collect::<Result<_>>()?,
        ),
    })
}
pub fn decode(raw: &[u8]) -> Result<(usize, Vec<Value>)> {
    let mut r = BinaryReader::new(raw);
    if r.bytes(4)? != CHUNK_MAGIC || r.byte()? != CHUNK_VERSION {
        return Err("invalid delta chunk".into());
    }
    let first = usize::try_from(r.varuint()?)?;
    let count = usize::try_from(r.varuint()?)?;
    if count == 0 || count > KEYFRAME_INTERVAL {
        return Err("invalid tick count".into());
    }
    let (mut prev, mut prev2) = (None, None);
    let mut ticks = Vec::with_capacity(count);
    for i in 0..count {
        let next = if i == 0 {
            read_value(&mut r, 1)?
        } else {
            read_patched_value(&mut r, prev.as_ref(), prev2.as_ref(), 1)?
        };
        ticks.push(json(&next)?);
        prev2 = prev.replace(next);
    }
    if r.offset != raw.len() {
        return Err("trailing delta bytes".into());
    }
    Ok((first, ticks))
}
pub fn encode(ticks: &[Value], first: usize) -> Result<Vec<u8>> {
    encode_chunk(ticks, first)
}
pub fn compress(raw: &[u8]) -> Result<Vec<u8>> {
    let mut c = zstd::bulk::Compressor::new(6)?;
    c.include_checksum(true)?;
    c.include_contentsize(true)?;
    Ok(c.compress(raw)?)
}
pub fn decompress(packed: &[u8], size: usize) -> Result<Vec<u8>> {
    if size > MAX_BLOCK {
        return Err("block too large".into());
    }
    let raw = zstd::bulk::decompress(packed, size)?;
    if raw.len() != size {
        return Err("block size mismatch".into());
    }
    Ok(raw)
}

pub struct Container {
    file: File,
    pub manifest: Value,
    pub bytes: u64,
    base: u64,
}
impl Container {
    pub fn open(path: &Path, magic: &[u8; 8]) -> Result<Self> {
        let mut file = File::open(path)?;
        let bytes = file.metadata()?.len();
        let mut h = [0u8; 32];
        file.read_exact(&mut h)?;
        let at = |i| u32::from_le_bytes(h[i..i + 4].try_into().unwrap()) as usize;
        if &h[..8] != magic
            || h[8..16] != [32, 0, 1, 0, 1, 0, 0, 0]
            || h[28..32] != [0; 4]
            || at(24) as u64 != bytes
            || bytes > MAX_ARTIFACT_BYTES
            || at(16) > MAX_BLOCK
            || at(20) > MAX_BLOCK
        {
            return Err("invalid container header".into());
        }
        let mut packed = vec![0; at(16)];
        file.read_exact(&mut packed)?;
        let manifest: Value = serde_json::from_slice(&decompress(&packed, at(20))?)?;
        let chunks = manifest["chunks"].as_array().ok_or("missing chunks")?;
        let (mut offset, mut ticks) = (0u64, 0u64);
        for (index, c) in chunks.iter().enumerate() {
            let count = c["tickCount"].as_u64().ok_or("missing count")?;
            let size = c["compressedBytes"].as_u64().ok_or("missing size")?;
            let raw = c["rawBytes"].as_u64().ok_or("missing raw size")?;
            if c["index"].as_u64() != Some(index as u64)
                || c["offset"].as_u64() != Some(offset)
                || c["firstTick"].as_u64() != Some(ticks)
                || count == 0
                || count > 2048
                || size > MAX_BLOCK as u64
                || raw > MAX_BLOCK as u64
            {
                return Err("invalid chunk index".into());
            }
            offset += size;
            ticks += count;
        }
        if chunks.is_empty()
            || ticks > MAX_TICKS as u64
            || manifest["tickCount"].as_u64() != Some(ticks)
            || 32 + packed.len() as u64 + offset != bytes
        {
            return Err("invalid coverage".into());
        }
        if magic == CONTAINER_MAGIC {
            let m: ViewerManifest = serde_json::from_value(manifest.clone())?;
            m.source_contract.validate(m.tick_count)?;
            if m.format != VIEWER_DELTA_FORMAT || m.keyframe_interval != KEYFRAME_INTERVAL {
                return Err("invalid source format".into());
            }
        }
        Ok(Self {
            file,
            manifest,
            bytes,
            base: 32 + packed.len() as u64,
        })
    }
    pub fn chunk(&mut self, index: usize) -> Result<Vec<u8>> {
        let c = &self.manifest["chunks"][index];
        self.file.seek(SeekFrom::Start(
            self.base + c["offset"].as_u64().ok_or("offset")?,
        ))?;
        let mut packed = vec![0; c["compressedBytes"].as_u64().ok_or("size")? as usize];
        self.file.read_exact(&mut packed)?;
        if c["compressedSha256"].as_str() != Some(&hash(&packed)) {
            return Err("chunk checksum mismatch".into());
        }
        decompress(&packed, c["rawBytes"].as_u64().ok_or("raw size")? as usize)
    }
}

pub struct Builder {
    path: PathBuf,
    payload: File,
    offset: u64,
    pub chunks: Vec<Value>,
}
impl Builder {
    pub fn new(output: &Path) -> Result<Self> {
        if output.exists() {
            return Err("output exists".into());
        }
        let path = output.with_extension("payload.partial");
        let payload = File::options()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok(Self {
            path,
            payload,
            offset: 0,
            chunks: Vec::new(),
        })
    }
    pub fn add(
        &mut self,
        raw: &[u8],
        first: usize,
        count: usize,
        tick_digest: &str,
    ) -> Result<usize> {
        let packed = compress(raw)?;
        if decompress(&packed, raw.len())? != raw {
            return Err("compression mismatch".into());
        }
        self.payload.write_all(&packed)?;
        self.chunks.push(
            serde_json::json!({"index":self.chunks.len(),"offset":self.offset,
            "firstTick":first,"tickCount":count,"rawBytes":raw.len(),"compressedBytes":packed.len(),
            "compressedSha256":hash(&packed),"tickSha256":tick_digest}),
        );
        self.offset += packed.len() as u64;
        Ok(packed.len())
    }
    pub fn finish(mut self, output: &Path, magic: &[u8; 8], mut manifest: Value) -> Result<u64> {
        manifest["chunks"] = Value::Array(std::mem::take(&mut self.chunks));
        let raw = serde_json::to_vec(&manifest)?;
        let packed = compress(&raw)?;
        let total = 32 + packed.len() as u64 + self.offset;
        let mut header = container_header(packed.len(), raw.len(), total)?;
        header[..8].copy_from_slice(magic);
        let mut out = File::options().write(true).create_new(true).open(output)?;
        out.write_all(&header)?;
        out.write_all(&packed)?;
        self.payload.seek(SeekFrom::Start(0))?;
        std::io::copy(&mut self.payload, &mut out)?;
        out.sync_all()?;
        drop(self.payload);
        fs::remove_file(self.path)?;
        Ok(total)
    }
}
