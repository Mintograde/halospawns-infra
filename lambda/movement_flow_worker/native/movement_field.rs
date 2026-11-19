//! Offline field extractor for the movement worker. Positions stay in tick order.
use serde::de::{SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::collections::BTreeMap;
use std::error::Error;
use std::fs::File;
use std::io::{BufReader, Read, Write};

mod viewer {
    #![allow(dead_code)]
    include!("../viewer.rs");
    include!("../movement_viewer.rs");
}

type Result<T> = std::result::Result<T, Box<dyn Error>>;
type Rows = BTreeMap<[i32; 4], [i64; 8]>;
const SLOTS: usize = 16;
const MAX_ROWS: usize = 160_000;
const MAX_FRAMES: usize = 432_000;
const SCALE: f64 = 4096.;
const MAX_SPEED: f64 = 16.;

#[derive(Clone, Copy)]
struct Point {
    position: [f64; 3],
    identity: i64,
}

struct Field {
    clock: Option<i64>,
    previous: [Option<Point>; SLOTS],
    groups: [Rows; SLOTS],
    rows: usize,
    frames: usize,
    rate: u32,
    start: usize,
    end: usize,
    ended: bool,
}

impl Field {
    fn new(rate: u32, start: usize, end: usize) -> Result<Self> {
        if !matches!(rate, 30 | 120) || start > end {
            return Err("invalid movement clock".into());
        }
        Ok(Self {
            clock: None,
            previous: [None; SLOTS],
            groups: Default::default(),
            rows: 0,
            frames: 0,
            rate,
            start,
            end,
            ended: false,
        })
    }
    fn frame(
        &mut self,
        clock: Option<i64>,
        ended: bool,
        current: [Option<Point>; SLOTS],
    ) -> Result<()> {
        if self.frames >= MAX_FRAMES {
            return Err("too many movement frames".into());
        }
        self.ended |= ended;
        if self.frames > self.start
            && self.frames < self.end
            && !self.ended
            && self
                .clock
                .zip(clock)
                .is_some_and(|(a, b)| a.checked_add(1) == Some(b))
        {
            for (slot, point) in current.iter().enumerate() {
                if let (Some(a), Some(b)) = (self.previous[slot], point)
                    && a.identity == b.identity
                {
                    self.segment(slot, a.position, b.position)?;
                }
            }
        }
        self.previous = current;
        self.clock = clock;
        self.frames += 1;
        Ok(())
    }
    fn segment(&mut self, slot: usize, a: [f64; 3], b: [f64; 3]) -> Result<()> {
        // Each interval has its own clock and life. A teleport or missing frame never adds traffic.
        let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let horizontal = d[0].hypot(d[2]);
        let distance = horizontal.hypot(d[1]);
        let speed = distance * f64::from(self.rate);
        if !(0.035..=MAX_SPEED).contains(&speed) {
            return Ok(());
        }
        let heading = if d[1].abs() > 1.5 * horizontal {
            if d[1] > 0. { 8 } else { 9 }
        } else {
            (d[2].atan2(d[0]) * 4. / std::f64::consts::PI).round() as i32 & 7
        };
        let mid = std::array::from_fn::<_, 3, _>(|i| (a[i] + b[i]) * 0.5);
        let cell = mid.map(|v| v.floor() as i32);
        let key = [cell[0], cell[1], cell[2], heading];
        let cells = &mut self.groups[slot];
        let value = cells.entry(key).or_insert_with(|| {
            self.rows += 1;
            [0; 8]
        });
        if self.rows > MAX_ROWS {
            return Err("movement field exceeds cell limit".into());
        }
        let time = i64::from(120 / self.rate);
        value[0] += time;
        for i in 0..3 {
            // Quantize endpoints before subtracting: consecutive displacements telescope.
            value[1 + i] += (b[i] * SCALE).round() as i64 - (a[i] * SCALE).round() as i64;
            value[5 + i] += ((mid[i] - f64::from(cell[i])) * 256.).round() as i64 * time;
        }
        value[4] += (distance * SCALE).round() as i64;
        Ok(())
    }
}

fn position(
    slot: Option<i64>,
    identity: Option<i64>,
    xyz: [Option<f64>; 3],
    health: Option<f64>,
    hostman: bool,
) -> Option<(usize, Point)> {
    let index = usize::try_from(slot?).ok()?;
    let id = identity?;
    if index >= SLOTS || hostman || id == -1 || id == 0xffffffff || health.is_some_and(|v| v <= 0.)
    {
        return None;
    }
    let [x, y, z] = xyz;
    let position = [x?, z?, -y?];
    position
        .iter()
        .all(|v| v.is_finite() && v.abs() < 1_000_000.)
        .then_some((
            index,
            Point {
                position,
                identity: id,
            },
        ))
}

fn object_number(s: &str) -> Option<i64> {
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        i64::from_str_radix(hex, 16).ok()
    } else {
        s.parse().ok()
    }
}

fn object_id<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Option<i64>, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(v.as_i64().or_else(|| v.as_str().and_then(object_number)))
}

#[derive(Default, Deserialize)]
struct RawBody {
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
    health: Option<f64>,
    #[serde(default, deserialize_with = "object_id")]
    object_id: Option<i64>,
}
#[derive(Default, Deserialize)]
struct RawStats {
    is_hostman: Option<bool>,
}
#[derive(Deserialize)]
struct RawPlayer {
    player_index: Option<i64>,
    name: Option<String>,
    deaths: Option<i64>,
    respawn_timer: Option<i64>,
    #[serde(default, deserialize_with = "object_id")]
    object_ref: Option<i64>,
    #[serde(default, deserialize_with = "object_id")]
    player_object_id: Option<i64>,
    player_object_data: Option<RawBody>,
    derived_stats: Option<RawStats>,
}

// Early Xbox recordings omit object IDs but record a life through the slot,
// player name, cumulative deaths, living health and a zero respawn timer.
#[derive(Default)]
struct RecordedLife {
    name: String,
    deaths: i64,
    identity: i64,
}

impl RecordedLife {
    fn identity(&mut self, player: &RawPlayer, body: &RawBody, frame: usize) -> Option<i64> {
        if let Some(id) = player
            .object_ref
            .or(player.player_object_id)
            .or(body.object_id)
        {
            return Some(id);
        }
        let name = player.name.as_deref().filter(|name| !name.is_empty())?;
        let deaths = player.deaths.filter(|n| *n >= 0)?;
        if player.respawn_timer != Some(0) || !body.health.is_some_and(|h| h > 0.) {
            return None;
        }
        if self.name != name || self.deaths != deaths {
            self.name.clear();
            self.name.push_str(name);
            self.deaths = deaths;
            // Keep fallback identities disjoint from each on-disk 32-bit object ID.
            self.identity = i64::MIN + frame as i64;
        }
        Some(self.identity)
    }
}
#[derive(Deserialize)]
struct Time {
    game_time: Option<i64>,
}
#[derive(Deserialize)]
struct RawTick {
    current_tick: Option<i64>,
    game_time_info: Option<Time>,
    game_ended_this_tick: Option<bool>,
    #[serde(default)]
    players: Vec<RawPlayer>,
}

// Serde skips unrelated fields in place, including bones and objects. Keep one tick resident.
struct Ticks<'a>(&'a mut Field);
impl<'de> serde::de::DeserializeSeed<'de> for Ticks<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> std::result::Result<(), D::Error> {
        d.deserialize_seq(self)
    }
}
impl<'de> Visitor<'de> for Ticks<'_> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("replay ticks")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<(), A::Error> {
        let mut lives: [RecordedLife; SLOTS] = Default::default();
        while let Some(t) = seq.next_element::<RawTick>()? {
            let mut points = [None; SLOTS];
            for p in t.players {
                if let Some(b) = &p.player_object_data
                    && let Some(life) = p
                        .player_index
                        .and_then(|s| usize::try_from(s).ok())
                        .and_then(|slot| lives.get_mut(slot))
                    && let Some((slot, value)) = position(
                        p.player_index,
                        life.identity(&p, b, self.0.frames),
                        [b.x, b.y, b.z],
                        b.health,
                        p.derived_stats.and_then(|s| s.is_hostman) == Some(true),
                    )
                {
                    points[slot] = Some(value);
                }
            }
            self.0
                .frame(
                    t.game_time_info
                        .and_then(|v| v.game_time)
                        .or(t.current_tick),
                    t.game_ended_this_tick == Some(true),
                    points,
                )
                .map_err(serde::de::Error::custom)?;
        }
        Ok(())
    }
}
struct Recording<'a>(&'a mut Field);
impl<'de> Visitor<'de> for Recording<'_> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("replay document")
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(
        self,
        mut map: A,
    ) -> std::result::Result<(), A::Error> {
        let mut found = false;
        while let Some(key) = map.next_key::<String>()? {
            if key == "ticks" && !found {
                map.next_value_seed(Ticks(self.0))?;
                found = true;
            } else {
                map.next_value::<serde::de::IgnoredAny>()?;
            }
        }
        if !found {
            return Err(serde::de::Error::custom("missing ticks"));
        }
        Ok(())
    }
}

fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let [format, path, rate, start, end, expected] = args.as_slice() else {
        return Err("expected format, file, clock and frame bounds".into());
    };
    let mut field = Field::new(rate.parse()?, start.parse()?, end.parse()?)?;
    let mut src = BufReader::new(File::open(path)?);
    if format == "viewer" {
        viewer::movement_world(&mut src, &mut field, expected.parse()?)?;
    } else if format == "recording" {
        use std::io::BufRead;
        let magic = src.fill_buf()?;
        let reader: Box<dyn Read> = if magic.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) {
            Box::new(zstd::Decoder::new(src)?)
        } else if magic.starts_with(&[0x1f, 0x8b]) {
            Box::new(flate2::read::GzDecoder::new(src))
        } else {
            Box::new(src)
        };
        let limit = 8u64 << 30;
        let mut bounded = reader.take(limit + 1);
        let mut parser =
            serde_json::Deserializer::from_reader(BufReader::with_capacity(1 << 20, &mut bounded));
        (&mut parser).deserialize_map(Recording(&mut field))?;
        parser.end()?;
        if bounded.limit() == 0 {
            return Err("recording exceeds decoded limit".into());
        }
    } else {
        return Err("unknown movement source".into());
    }
    let mut groups = BTreeMap::new();
    for (slot, rows) in field
        .groups
        .into_iter()
        .enumerate()
        .filter(|(_, r)| !r.is_empty())
    {
        groups.insert(
            slot,
            rows.into_iter()
                .map(|(k, v)| k.into_iter().map(i64::from).chain(v).collect::<Vec<_>>())
                .collect::<Vec<_>>(),
        );
    }
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    serde_json::to_writer(&mut output, &groups)?;
    output.flush()?;
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("movement extractor: {e}");
        std::process::exit(1);
    }
}
