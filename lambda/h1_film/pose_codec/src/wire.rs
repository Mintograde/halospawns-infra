use crate::{
    legacy::{self, Result},
    pose::{self, Pose, Settings, Skeleton},
};
use glam::DQuat;
use serde::Serialize;
use serde_json::Value;

#[derive(Default)]
struct Writer(Vec<u8>);
impl Writer {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u16(&mut self, v: usize) {
        self.0.extend_from_slice(&(v as u16).to_le_bytes());
    }
    fn u32(&mut self, v: usize) {
        self.0.extend_from_slice(&(v as u32).to_le_bytes());
    }
    fn i32(&mut self, v: i32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn signed(&mut self, v: i64) {
        let mut n = ((v << 1) ^ (v >> 63)) as u64;
        while n >= 128 {
            self.u8((n as u8) | 128);
            n >>= 7;
        }
        self.u8(n as u8);
    }
}
struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Self { b, at: 0 }
    }
    fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.at.checked_add(n).ok_or("overflow")?;
        let b = self.b.get(self.at..end).ok_or("truncated pose block")?;
        self.at = end;
        Ok(b)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }
    fn u16(&mut self) -> Result<usize> {
        Ok(u16::from_le_bytes(self.bytes(2)?.try_into()?) as usize)
    }
    fn u32(&mut self) -> Result<usize> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into()?) as usize)
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.bytes(4)?.try_into()?))
    }
    fn signed(&mut self) -> Result<i64> {
        let mut n = 0u64;
        for shift in (0..=63).step_by(7) {
            let b = self.u8()?;
            if shift == 63 && b > 1 {
                return Err("varint overflow".into());
            }
            n |= ((b & 127) as u64) << shift;
            if b < 128 {
                return Ok(((n >> 1) as i64) ^ -((n & 1) as i64));
            }
        }
        Err("invalid varint".into())
    }
    fn end(&self) -> Result<()> {
        if self.at != self.b.len() {
            Err("trailing pose bytes".into())
        } else {
            Ok(())
        }
    }
}

fn track(values: &[i32], w: &mut Writer) {
    if values.iter().all(|v| *v == values[0]) {
        w.u8(0);
        w.i32(values[0]);
        return;
    }
    let mut d = Writer::default();
    let mut d2 = Writer::default();
    let mut last_delta = 0;
    for pair in values.windows(2) {
        let delta = pair[1] as i64 - pair[0] as i64;
        d.signed(delta);
        d2.signed(delta - last_delta);
        last_delta = delta;
    }
    let (mode, bytes) = if d2.0.len() < d.0.len() {
        (2, d2.0)
    } else {
        (1, d.0)
    };
    w.u8(mode);
    w.i32(values[0]);
    w.0.extend(bytes);
}
fn untrack(r: &mut Reader, n: usize) -> Result<Vec<i32>> {
    let mode = r.u8()?;
    if mode > 2 {
        return Err("unknown track mode".into());
    }
    let mut last = r.i32()?;
    let mut out = vec![last];
    let mut delta = 0i64;
    for _ in 1..n {
        if mode != 0 {
            let d = r.signed()?;
            delta = if mode == 1 {
                d
            } else {
                delta.checked_add(d).ok_or("delta overflow")?
            };
            last = i32::try_from((last as i64).checked_add(delta).ok_or("value overflow")?)?;
        }
        out.push(last);
    }
    Ok(out)
}

struct Frame {
    values: Vec<[i32; 8]>,
    raw: Option<Pose>,
}
struct Run {
    first: usize,
    player: usize,
    identity: Value,
    tag: String,
    parents: Vec<i32>,
    frames: Vec<Frame>,
    previous: Vec<DQuat>,
}

#[derive(Default, Serialize)]
pub struct Counts {
    pub poses: u64,
    pub raw_poses: u64,
    pub runs: u64,
    pub constant_tracks: u64,
    pub tracks: u64,
    pub base_bytes: u64,
    pub pose_bytes: u64,
}
impl Counts {
    pub fn add(&mut self, b: &Self) {
        self.poses += b.poses;
        self.raw_poses += b.raw_poses;
        self.runs += b.runs;
        self.constant_tracks += b.constant_tracks;
        self.tracks += b.tracks;
        self.base_bytes += b.base_bytes;
        self.pose_bytes += b.pose_bytes;
    }
}

// Retain integer tracks, not full JSON tick trees, while the base codec streams.
pub struct Encoder {
    settings: Settings,
    rigs: Vec<Skeleton>,
    preserve_unknown_models: bool,
    runs: Vec<Run>,
    latest: [Option<usize>; 4],
    counts: Counts,
    tick_count: usize,
}

impl Encoder {
    pub fn new(s: &Settings, rigs: &[Skeleton], preserve_unknown_models: bool) -> Result<Self> {
        s.validate()?;
        Ok(Self {
            settings: s.clone(),
            rigs: rigs.to_vec(),
            preserve_unknown_models,
            runs: Vec::new(),
            latest: [None; 4],
            counts: Counts::default(),
            tick_count: 0,
        })
    }

    pub fn push(&mut self, t: &mut Value) -> Result<()> {
        if self.tick_count >= 2048 {
            return Err("too many pose chunk ticks".into());
        }
        let tick = self.tick_count;
        let s = &self.settings;
        let rigs = &self.rigs;
        let runs = &mut self.runs;
        let latest = &mut self.latest;
        let counts = &mut self.counts;
        let players = t["players"].as_array_mut().ok_or("players missing")?;
        if players.len() > 4 {
            return Err("pose codec supports at most four players".into());
        }
        for (pi, p) in players.iter_mut().enumerate() {
            let Some(nodes) = p.get("model_nodes").and_then(Value::as_array) else {
                continue;
            };
            if nodes.is_empty() {
                continue;
            }
            let pose = pose::read_pose(&p["model_nodes"])?;
            let tag = p["player_object_data"]["tag_name"].as_str().unwrap_or("");
            if self.preserve_unknown_models && pose::parents(tag, pose.len(), s, rigs).is_err() {
                continue;
            }
            let identity =
                serde_json::json!([p["player_index"], p["player_object_id"], p["object_ref"]]);
            let previous = latest[pi].filter(|i: &usize| {
                let r = &runs[*i];
                r.first + r.frames.len() == tick
                    && r.identity == identity
                    && r.tag == tag
                    && r.parents.len() == pose.len()
            });
            let ri = if let Some(i) = previous {
                i
            } else {
                let i = runs.len();
                let parents = pose::parents(tag, pose.len(), s, rigs)?;
                pose::order(&parents)?;
                runs.push(Run {
                    first: tick,
                    player: pi,
                    identity,
                    tag: tag.into(),
                    parents,
                    frames: Vec::new(),
                    previous: Vec::new(),
                });
                latest[pi] = Some(i);
                i
            };
            let r = &mut runs[ri];
            let values = pose::quantize(&pose, &r.parents, pose::origin(p), s, &mut r.previous);
            counts.poses += 1;
            let frame = if let Some(values) = values {
                let decoded = pose::reconstruct(&values, &r.parents, pose::origin(p), s)?;
                if pose.iter().zip(&decoded).any(|(a, b)| {
                    let bound = pose::point_bound(a, b, s.point_radius);
                    !bound.is_finite() || bound > s.point_error_limit
                }) {
                    return Err("pose reconstruction exceeds error bound".into());
                }
                Frame { values, raw: None }
            } else {
                counts.raw_poses += 1;
                r.previous.clear();
                Frame {
                    values: vec![[0; 8]; pose.len()],
                    raw: Some(pose),
                }
            };
            r.frames.push(frame);
            p.as_object_mut()
                .ok_or("player not object")?
                .shift_remove("model_nodes");
        }
        self.tick_count += 1;
        Ok(())
    }

    // The caller verifies the lossless base stream before passing it here.
    pub fn finish(mut self, base_raw: &[u8]) -> Result<(Vec<u8>, Counts)> {
        if self.tick_count == 0 {
            return Err("empty pose chunk".into());
        }
        let runs = &self.runs;
        let counts = &mut self.counts;
        let base_packed = legacy::compress(base_raw)?;
        let mut w = Writer::default();
        w.u16(runs.len());
        counts.runs = runs.len() as u64;
        for r in runs {
            w.u16(r.first);
            w.u8(r.player as u8);
            w.u16(r.frames.len());
            w.u8(r.parents.len() as u8);
            for p in &r.parents {
                w.u8((p + 1) as u8);
            }
            for node in 0..r.parents.len() {
                for ch in 0..8 {
                    let values: Vec<_> = r.frames.iter().map(|f| f.values[node][ch]).collect();
                    counts.tracks += 1;
                    counts.constant_tracks += u64::from(values.iter().all(|v| *v == values[0]));
                    track(&values, &mut w);
                }
            }
            w.u16(r.frames.iter().filter(|f| f.raw.is_some()).count());
            for (fi, f) in r.frames.iter().enumerate() {
                if let Some(pose) = &f.raw {
                    w.u16(fi);
                    for node in pose {
                        for v in node {
                            w.0.extend_from_slice(&v.to_le_bytes());
                        }
                    }
                }
            }
        }
        verify_tracks(&w.0, runs)?;
        let poses_packed = legacy::compress(&w.0)?;
        counts.base_bytes = base_packed.len() as u64;
        counts.pose_bytes = poses_packed.len() as u64;
        let mut block = Writer::default();
        block.0.extend_from_slice(b"PC01");
        block.u32(base_raw.len());
        block.u32(base_packed.len());
        block.u32(w.0.len());
        block.u32(poses_packed.len());
        block.0.extend(base_packed);
        block.0.extend(poses_packed);
        if block.0.len() > 64 * 1024 * 1024 {
            return Err("pose chunk exceeds decode limit".into());
        }
        Ok((block.0, self.counts))
    }
}

fn verify_tracks(bytes: &[u8], runs: &[Run]) -> Result<()> {
    let mut reader = Reader::new(bytes);
    if reader.u16()? != runs.len() {
        return Err("pose run count changed".into());
    }
    for run in runs {
        if reader.u16()? != run.first
            || reader.u8()? as usize != run.player
            || reader.u16()? != run.frames.len()
            || reader.u8()? as usize != run.parents.len()
        {
            return Err("pose run header changed".into());
        }
        for parent in &run.parents {
            if reader.u8()? as i32 - 1 != *parent {
                return Err("pose parent changed".into());
            }
        }
        for node in 0..run.parents.len() {
            for channel in 0..8 {
                let decoded = untrack(&mut reader, run.frames.len())?;
                if decoded
                    .iter()
                    .zip(&run.frames)
                    .any(|(v, f)| *v != f.values[node][channel])
                {
                    return Err("pose track changed".into());
                }
            }
        }
        if reader.u16()? != run.frames.iter().filter(|f| f.raw.is_some()).count() {
            return Err("raw pose count changed".into());
        }
        for (index, frame) in run.frames.iter().enumerate() {
            if let Some(pose) = &frame.raw {
                if reader.u16()? != index {
                    return Err("raw pose index changed".into());
                }
                for node in pose {
                    for value in node {
                        if reader.bytes(8)? != value.to_le_bytes() {
                            return Err("raw pose value changed".into());
                        }
                    }
                }
            }
        }
    }
    reader.end()
}

pub fn pack(
    ticks: &[Value],
    first: usize,
    s: &Settings,
    rigs: &[Skeleton],
    codec: &impl crate::BaseCodec,
    preserve_unknown_models: bool,
) -> Result<(Vec<u8>, Counts)> {
    let mut encoder = Encoder::new(s, rigs, preserve_unknown_models)?;
    let mut base = ticks.to_vec();
    for tick in &mut base {
        encoder.push(tick)?;
    }
    let base_raw = codec.encode(&base, first)?;
    let (decoded_first, decoded_base) = codec.decode(&base_raw)?;
    if first != decoded_first || !legacy::equal(&Value::Array(base), &Value::Array(decoded_base)) {
        return Err("non-pose encode changed values".into());
    }
    encoder.finish(&base_raw)
}

pub fn unpack(
    block: &[u8],
    s: &Settings,
    codec: &impl crate::BaseCodec,
) -> Result<(usize, Vec<Value>)> {
    s.validate()?;
    let mut r = Reader::new(block);
    if r.bytes(4)? != b"PC01" {
        return Err("invalid pose chunk".into());
    }
    let br = r.u32()?;
    let bc = r.u32()?;
    let pr = r.u32()?;
    let pc = r.u32()?;
    let base = legacy::decompress(r.bytes(bc)?, br)?;
    let poses = legacy::decompress(r.bytes(pc)?, pr)?;
    r.end()?;
    let (first, mut ticks) = codec.decode(&base)?;
    if ticks.is_empty() || ticks.len() > 2048 {
        return Err("invalid pose chunk tick count".into());
    }
    let mut r = Reader::new(&poses);
    let count = r.u16()?;
    if count > ticks.len() * 4 {
        return Err("too many pose runs".into());
    }
    let mut seen = vec![[false; 4]; ticks.len()];
    let mut pose_count = 0usize;
    for _ in 0..count {
        let start = r.u16()?;
        let pi = r.u8()? as usize;
        let n = r.u16()?;
        let bones = r.u8()? as usize;
        if n == 0 || start + n > ticks.len() || pi >= 4 || bones == 0 || bones > 64 {
            return Err("invalid pose run bounds".into());
        }
        pose_count += n;
        if pose_count > ticks.len() * 4 {
            return Err("too many poses".into());
        }
        let parents = (0..bones)
            .map(|_| Ok(r.u8()? as i32 - 1))
            .collect::<Result<Vec<_>>>()?;
        pose::order(&parents)?;
        let mut frames = vec![vec![[0; 8]; bones]; n];
        for node in 0..bones {
            for ch in 0..8 {
                let values = untrack(&mut r, n)?;
                for (f, v) in frames.iter_mut().zip(values) {
                    f[node][ch] = v;
                }
            }
        }
        let raw_count = r.u16()?;
        if raw_count > n {
            return Err("too many raw poses".into());
        }
        let mut raw = std::collections::BTreeMap::new();
        for _ in 0..raw_count {
            let index = r.u16()?;
            if index >= n || raw.contains_key(&index) {
                return Err("invalid raw pose index".into());
            }
            let mut pose = vec![[0.; 13]; bones];
            for node in &mut pose {
                for v in node {
                    *v = f64::from_le_bytes(r.bytes(8)?.try_into()?);
                    if !v.is_finite() {
                        return Err("nonfinite raw pose".into());
                    }
                }
            }
            raw.insert(index, pose);
        }
        for (fi, values) in frames.iter().enumerate() {
            let ti = start + fi;
            if seen[ti][pi] {
                return Err("overlapping pose runs".into());
            }
            seen[ti][pi] = true;
            let p = ticks[ti]["players"]
                .as_array_mut()
                .and_then(|p| p.get_mut(pi))
                .ok_or("pose player missing")?;
            if p.get("model_nodes").is_some() {
                return Err("pose overwrites base field".into());
            }
            let pose = if let Some(pose) = raw.remove(&fi) {
                pose
            } else {
                pose::reconstruct(values, &parents, pose::origin(p), s)?
            };
            p["model_nodes"] = serde_json::to_value(pose)?;
        }
    }
    r.end()?;
    Ok((first, ticks))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tracks_roundtrip_and_reject_truncation() {
        for values in [
            vec![0; 10],
            vec![-100, 200, i32::MAX, i32::MIN, 42],
            (0..2048).map(|i| i * i).collect(),
        ] {
            let mut w = Writer::default();
            track(&values, &mut w);
            let mut r = Reader::new(&w.0);
            assert_eq!(untrack(&mut r, values.len()).unwrap(), values);
            r.end().unwrap();
            assert!(untrack(&mut Reader::new(&w.0[..w.0.len() - 1]), values.len()).is_err());
        }
    }
}
