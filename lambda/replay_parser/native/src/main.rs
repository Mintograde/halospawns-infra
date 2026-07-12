use flate2::read::GzDecoder;
use serde::de::{SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::error::Error;
use std::fmt;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Instant;

const OUTPUT_SCHEMA: &str = "halospawns.replayExtractor.v1";
const MAX_COORDINATE_ABS: f64 = 1_000_000.0;
const MAX_CELLS_PER_SLOT: usize = 50_000;
const MAX_CELLS_TOTAL: usize = 200_000;
const MAX_COUNTER: u64 = 2_147_483_647;
const MAX_EVENT_SAMPLE: usize = 10;
const MAX_SPAWN_POINTS: usize = 512;
const BUFFER_SIZE: usize = 1024 * 1024;

static CELL_SIZE: OnceLock<f64> = OnceLock::new();

#[derive(Debug, Default)]
struct CapturedValue {
    present: bool,
    value: Value,
}

impl<'de> Deserialize<'de> for CapturedValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Self {
            present: true,
            value: Value::deserialize(deserializer)?,
        })
    }
}

impl CapturedValue {
    fn insert_scalar(&self, output: &mut Map<String, Value>, key: &str) {
        if self.present && !self.value.is_array() && !self.value.is_object() {
            output.insert(key.to_owned(), self.value.clone());
        }
    }

    fn object(&self) -> Option<&Map<String, Value>> {
        self.present.then_some(&self.value)?.as_object()
    }
}

#[derive(Debug, Default, Deserialize)]
struct Replay {
    #[serde(default)]
    summary: Value,
    #[serde(default)]
    game_meta: Value,
    #[serde(default)]
    gametype_settings: Value,
    #[serde(default)]
    network_game_client: Value,
    #[serde(default)]
    participant_context: Value,
    #[serde(default)]
    spawns: Value,
    #[serde(default, deserialize_with = "deserialize_ticks")]
    ticks: Ticks,
    #[serde(default, deserialize_with = "deserialize_events")]
    events: Events,
}

#[derive(Debug, Default)]
struct Ticks {
    count: u64,
    first: Option<Value>,
    last: Option<Value>,
    first_network_game_client: Option<Value>,
    spawn_points: Vec<SpawnPoint>,
    spawn_source_path: Option<String>,
    occupancy: Occupancy,
}

#[derive(Debug, Default, Deserialize)]
struct Tick {
    #[serde(default)]
    multiplayer_map_name: CapturedValue,
    #[serde(default)]
    game_type: CapturedValue,
    #[serde(default)]
    variant: CapturedValue,
    #[serde(default)]
    current_time: CapturedValue,
    #[serde(default)]
    start_time: CapturedValue,
    #[serde(default)]
    game_id: CapturedValue,
    #[serde(default)]
    game_ended_this_tick: CapturedValue,
    #[serde(default)]
    map_info: CapturedValue,
    #[serde(default)]
    game_time_info: CapturedValue,
    #[serde(default)]
    network_game_client: CapturedValue,
    #[serde(default)]
    spawns: CapturedValue,
    #[serde(default)]
    players: Vec<Player>,
}

impl Tick {
    fn selected_value(&self) -> Value {
        let mut output = Map::new();
        output.insert(
            "players".to_owned(),
            Value::Array(self.players.iter().map(Player::selected_value).collect()),
        );
        for (key, captured) in [
            ("multiplayer_map_name", &self.multiplayer_map_name),
            ("game_type", &self.game_type),
            ("variant", &self.variant),
            ("current_time", &self.current_time),
            ("start_time", &self.start_time),
            ("game_id", &self.game_id),
            ("game_ended_this_tick", &self.game_ended_this_tick),
        ] {
            captured.insert_scalar(&mut output, key);
        }
        for (key, captured) in [
            ("map_info", &self.map_info),
            ("game_time_info", &self.game_time_info),
            ("network_game_client", &self.network_game_client),
        ] {
            if let Some(mapping) = captured.object() {
                output.insert(key.to_owned(), Value::Object(mapping.clone()));
            }
        }
        Value::Object(output)
    }
}

#[derive(Debug, Default, Deserialize)]
struct Player {
    #[serde(default)]
    player_index: CapturedValue,
    #[serde(default)]
    local_player: CapturedValue,
    #[serde(default)]
    name: CapturedValue,
    #[serde(default)]
    player_name: CapturedValue,
    #[serde(default)]
    team: CapturedValue,
    #[serde(default)]
    score: CapturedValue,
    #[serde(default)]
    ctf_score: CapturedValue,
    #[serde(default)]
    kills: CapturedValue,
    #[serde(default)]
    deaths: CapturedValue,
    #[serde(default)]
    assists: CapturedValue,
    #[serde(default)]
    suicides: CapturedValue,
    #[serde(default)]
    team_kills: CapturedValue,
    #[serde(default)]
    player_quit: CapturedValue,
    #[serde(default)]
    derived_stats: Option<DerivedStats>,
    #[serde(default)]
    player_object_data: Option<PlayerObjectData>,
}

impl Player {
    fn selected_value(&self) -> Value {
        let mut output = Map::new();
        for (key, captured) in [
            ("player_index", &self.player_index),
            ("local_player", &self.local_player),
            ("name", &self.name),
            ("player_name", &self.player_name),
            ("team", &self.team),
            ("score", &self.score),
            ("ctf_score", &self.ctf_score),
            ("kills", &self.kills),
            ("deaths", &self.deaths),
            ("assists", &self.assists),
            ("suicides", &self.suicides),
            ("team_kills", &self.team_kills),
            ("player_quit", &self.player_quit),
        ] {
            captured.insert_scalar(&mut output, key);
        }
        if let Some(derived) = &self.derived_stats {
            derived.is_host.insert_scalar(&mut output, "is_host");
            derived.is_hostman.insert_scalar(&mut output, "is_hostman");
        }
        Value::Object(output)
    }
}

#[derive(Debug, Default, Deserialize)]
struct DerivedStats {
    #[serde(default)]
    is_host: CapturedValue,
    #[serde(default)]
    is_hostman: CapturedValue,
}

#[derive(Debug, Default, Deserialize)]
struct PlayerObjectData {
    #[serde(default)]
    x: CapturedValue,
    #[serde(default)]
    y: CapturedValue,
    #[serde(default)]
    z: CapturedValue,
}

#[derive(Debug, Default)]
struct Events {
    count: u64,
    sample: Vec<Value>,
}

#[derive(Debug, Default)]
struct Occupancy {
    samples_seen: u64,
    cells: HashMap<CellKey, u64>,
    cell_counts_by_slot: HashMap<i64, usize>,
    observations_by_slot: HashMap<i64, u64>,
    discarded: BTreeMap<&'static str, u64>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct CellKey {
    slot: i64,
    x: i64,
    y: i64,
    z: i64,
}

impl Occupancy {
    fn observe(&mut self, player: &Player) {
        self.samples_seen = bounded_add(self.samples_seen, 1);
        let Some(slot) = spatial_slot(&player.player_index.value) else {
            self.discard("invalid_slot");
            return;
        };
        if player
            .derived_stats
            .as_ref()
            .and_then(|stats| optional_bool(&stats.is_hostman.value))
            == Some(true)
        {
            self.discard("hostman");
            return;
        }
        let Some(position) = &player.player_object_data else {
            self.discard("missing_player_object");
            return;
        };
        if !position.x.present || !position.y.present || !position.z.present {
            self.discard("missing_coordinate");
            return;
        }
        let Some(x) = spatial_coordinate(&position.x.value) else {
            self.discard("non_finite");
            return;
        };
        let Some(y) = spatial_coordinate(&position.y.value) else {
            self.discard("non_finite");
            return;
        };
        let Some(z) = spatial_coordinate(&position.z.value) else {
            self.discard("non_finite");
            return;
        };
        if x.abs() > MAX_COORDINATE_ABS
            || y.abs() > MAX_COORDINATE_ABS
            || z.abs() > MAX_COORDINATE_ABS
        {
            self.discard("out_of_bounds");
            return;
        }

        let cell_size = *CELL_SIZE.get().expect("cell size initialized");
        let key = CellKey {
            slot,
            x: (x / cell_size).floor() as i64,
            y: (y / cell_size).floor() as i64,
            z: (z / cell_size).floor() as i64,
        };
        if !self.cells.contains_key(&key) {
            if self
                .cell_counts_by_slot
                .get(&slot)
                .copied()
                .unwrap_or_default()
                >= MAX_CELLS_PER_SLOT
            {
                self.discard("slot_cell_limit");
                return;
            }
            if self.cells.len() >= MAX_CELLS_TOTAL {
                self.discard("global_cell_limit");
                return;
            }
            *self.cell_counts_by_slot.entry(slot).or_default() += 1;
        }

        let count = self.cells.entry(key).or_default();
        *count = bounded_add(*count, 1);
        let observations = self.observations_by_slot.entry(slot).or_default();
        *observations = bounded_add(*observations, 1);
    }

    fn discard(&mut self, reason: &'static str) {
        let count = self.discarded.entry(reason).or_default();
        *count = bounded_add(*count, 1);
    }
}

struct TicksVisitor;

impl<'de> Visitor<'de> for TicksVisitor {
    type Value = Ticks;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a replay ticks array")
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut output = Ticks::default();
        while let Some(tick) = sequence.next_element::<Tick>()? {
            let tick_index = output.count;
            output.count = output.count.saturating_add(1);
            if output.first_network_game_client.is_none()
                && let Some(mapping) = tick.network_game_client.object()
                && !mapping.is_empty()
            {
                output.first_network_game_client = Some(Value::Object(mapping.clone()));
            }
            if output.spawn_points.is_empty() && tick.spawns.present {
                let points = spawn_points_from_records(&tick.spawns.value);
                if !points.is_empty() {
                    output.spawn_points = points;
                    output.spawn_source_path = Some(format!("$.ticks[{tick_index}].spawns"));
                }
            }
            for player in &tick.players {
                output.occupancy.observe(player);
            }
            let selected = tick.selected_value();
            if output.first.is_none() {
                output.first = Some(selected.clone());
            }
            output.last = Some(selected);
        }
        Ok(output)
    }
}

fn deserialize_ticks<'de, D>(deserializer: D) -> Result<Ticks, D::Error>
where
    D: Deserializer<'de>,
{
    deserializer.deserialize_seq(TicksVisitor)
}

struct EventsVisitor;

impl<'de> Visitor<'de> for EventsVisitor {
    type Value = Events;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a replay events array")
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut output = Events::default();
        while let Some(event) = sequence.next_element::<Value>()? {
            output.count = output.count.saturating_add(1);
            if output.sample.len() < MAX_EVENT_SAMPLE {
                output.sample.push(event);
            }
        }
        Ok(output)
    }
}

fn deserialize_events<'de, D>(deserializer: D) -> Result<Events, D::Error>
where
    D: Deserializer<'de>,
{
    deserializer.deserialize_seq(EventsVisitor)
}

#[derive(Debug, Clone, Serialize)]
struct SpawnPoint {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Serialize)]
struct ParserMetadata<'a> {
    name: &'a str,
    json_library: &'a str,
    version: &'a str,
}

#[derive(Serialize)]
struct Limits {
    coordinate_absolute_max: f64,
    cells_per_slot: usize,
    cells_total: usize,
    counter: u64,
}

#[derive(Serialize)]
struct CellRecord {
    slot_index: i64,
    cell: [i64; 3],
    observed_ticks: u64,
}

#[derive(Serialize)]
struct SpatialOutput {
    cell_size: f64,
    samples_seen: u64,
    observations_by_slot: BTreeMap<i64, u64>,
    discarded: BTreeMap<&'static str, u64>,
    cells: Vec<CellRecord>,
    limits: Limits,
}

#[derive(Serialize)]
struct ExtractorOutput {
    schema: &'static str,
    parser: ParserMetadata<'static>,
    parse_duration_ms: u128,
    summary: Value,
    game_meta: Value,
    gametype_settings: Value,
    network_game_client: Value,
    participant_context: Value,
    first_tick: Value,
    last_tick: Value,
    spawn_points: Vec<SpawnPoint>,
    spawn_source_path: Option<String>,
    tick_count: u64,
    event_count: u64,
    event_sample: Vec<Value>,
    spatial_occupancy: SpatialOutput,
}

fn extract_replay(reader: impl Read) -> Result<ExtractorOutput, Box<dyn Error>> {
    let started = Instant::now();
    let replay: Replay = serde_json::from_reader(BufReader::with_capacity(BUFFER_SIZE, reader))?;
    let mut ticks = replay.ticks;

    let top_level_spawn_points = spawn_points_from_records(&replay.spawns);
    if !top_level_spawn_points.is_empty() {
        ticks.spawn_points = top_level_spawn_points;
        ticks.spawn_source_path = Some("$.spawns".to_owned());
    }
    let network_game_client = if replay
        .network_game_client
        .as_object()
        .is_some_and(|mapping| !mapping.is_empty())
    {
        replay.network_game_client
    } else {
        ticks.first_network_game_client.unwrap_or(Value::Null)
    };

    let mut cells: Vec<CellRecord> = ticks
        .occupancy
        .cells
        .into_iter()
        .map(|(key, observed_ticks)| CellRecord {
            slot_index: key.slot,
            cell: [key.x, key.y, key.z],
            observed_ticks,
        })
        .collect();
    cells.sort_by_key(|record| {
        (
            record.slot_index,
            record.cell[0],
            record.cell[1],
            record.cell[2],
        )
    });

    Ok(ExtractorOutput {
        schema: OUTPUT_SCHEMA,
        parser: ParserMetadata {
            name: "replay-extractor",
            json_library: "serde_json",
            version: env!("CARGO_PKG_VERSION"),
        },
        parse_duration_ms: started.elapsed().as_millis(),
        summary: replay.summary,
        game_meta: replay.game_meta,
        gametype_settings: replay.gametype_settings,
        network_game_client,
        participant_context: replay.participant_context,
        first_tick: ticks.first.unwrap_or(Value::Object(Map::new())),
        last_tick: ticks.last.unwrap_or(Value::Object(Map::new())),
        spawn_points: ticks.spawn_points,
        spawn_source_path: ticks.spawn_source_path,
        tick_count: ticks.count,
        event_count: replay.events.count,
        event_sample: replay.events.sample,
        spatial_occupancy: SpatialOutput {
            cell_size: *CELL_SIZE.get().expect("cell size initialized"),
            samples_seen: ticks.occupancy.samples_seen,
            observations_by_slot: ticks.occupancy.observations_by_slot.into_iter().collect(),
            discarded: ticks.occupancy.discarded,
            cells,
            limits: Limits {
                coordinate_absolute_max: MAX_COORDINATE_ABS,
                cells_per_slot: MAX_CELLS_PER_SLOT,
                cells_total: MAX_CELLS_TOTAL,
                counter: MAX_COUNTER,
            },
        },
    })
}

fn input_reader(path: &Path) -> Result<Box<dyn Read>, Box<dyn Error>> {
    let mut magic = [0_u8; 4];
    let mut probe = File::open(path)?;
    let bytes_read = probe.read(&mut magic)?;
    if bytes_read >= 4 && magic == [0x28, 0xb5, 0x2f, 0xfd] {
        return Ok(Box::new(zstd::stream::read::Decoder::new(File::open(
            path,
        )?)?));
    }
    if bytes_read >= 2 && magic[..2] == [0x1f, 0x8b] {
        return Ok(Box::new(GzDecoder::new(BufReader::with_capacity(
            BUFFER_SIZE,
            File::open(path)?,
        ))));
    }
    if bytes_read >= 2 && magic[..2] == [b'P', b'K'] {
        return Err("zip replay inputs require the Python fallback".into());
    }
    Ok(Box::new(BufReader::with_capacity(
        BUFFER_SIZE,
        File::open(path)?,
    )))
}

fn spawn_points_from_records(records: &Value) -> Vec<SpawnPoint> {
    let Some(records) = records.as_array() else {
        return Vec::new();
    };
    records
        .iter()
        .filter_map(spawn_point_from_record)
        .take(MAX_SPAWN_POINTS)
        .collect()
}

fn spawn_point_from_record(record: &Value) -> Option<SpawnPoint> {
    if let Some(mapping) = record.as_object() {
        if let Some(point) = point_from_mapping(mapping) {
            return Some(point);
        }
        for key in ["position", "translation", "origin", "location"] {
            if let Some(point) = mapping.get(key).and_then(point_from_value) {
                return Some(point);
            }
        }
    }
    point_from_value(record)
}

fn point_from_value(value: &Value) -> Option<SpawnPoint> {
    if let Some(mapping) = value.as_object() {
        return point_from_mapping(mapping);
    }
    let items = value.as_array()?;
    (items.len() >= 3).then(|| point_from_components(&items[0], &items[1], &items[2]))?
}

fn point_from_mapping(mapping: &Map<String, Value>) -> Option<SpawnPoint> {
    point_from_components(mapping.get("x")?, mapping.get("y")?, mapping.get("z")?)
}

fn point_from_components(x: &Value, y: &Value, z: &Value) -> Option<SpawnPoint> {
    let point = SpawnPoint {
        x: value_as_f64(x)?,
        y: value_as_f64(y)?,
        z: value_as_f64(z)?,
    };
    (point.x.is_finite() && point.y.is_finite() && point.z.is_finite()).then_some(point)
}

fn spatial_slot(value: &Value) -> Option<i64> {
    if value.is_boolean() {
        return None;
    }
    let number = value_as_f64(value)?;
    if !number.is_finite() || number.fract() != 0.0 || !(0.0..64.0).contains(&number) {
        return None;
    }
    Some(number as i64)
}

fn spatial_coordinate(value: &Value) -> Option<f64> {
    if value.is_boolean() {
        return None;
    }
    value_as_f64(value).filter(|number| number.is_finite())
}

fn value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

fn optional_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::Number(value) if value.as_i64() == Some(0) => Some(false),
        Value::Number(value) if value.as_i64() == Some(1) => Some(true),
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" | "y" | "t" => Some(true),
            "0" | "false" | "no" | "off" | "n" | "f" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn bounded_add(current: u64, amount: u64) -> u64 {
    current.saturating_add(amount).min(MAX_COUNTER)
}

fn parse_args() -> Result<(PathBuf, PathBuf, f64), Box<dyn Error>> {
    let mut input = None;
    let mut output = None;
    let mut cell_size = 0.5;
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--input" => input = args.next().map(PathBuf::from),
            "--output" => output = args.next().map(PathBuf::from),
            "--cell-size" => {
                cell_size = args.next().ok_or("--cell-size requires a value")?.parse()?;
            }
            _ => return Err(format!("unknown argument: {argument}").into()),
        }
    }
    if !matches!(cell_size, 0.5 | 1.0) {
        return Err("--cell-size must be 0.5 or 1.0".into());
    }
    Ok((
        input.ok_or("--input is required")?,
        output.ok_or("--output is required")?,
        cell_size,
    ))
}

fn run() -> Result<(), Box<dyn Error>> {
    let (input, output, cell_size) = parse_args()?;
    CELL_SIZE
        .set(cell_size)
        .map_err(|_| "cell size was already initialized")?;
    let extracted = extract_replay(input_reader(&input)?)?;
    let file = File::create(output)?;
    let mut writer = BufWriter::with_capacity(BUFFER_SIZE, file);
    serde_json::to_writer(&mut writer, &extracted)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("replay-extractor: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn initialize() {
        let _ = CELL_SIZE.set(0.5);
    }

    #[test]
    fn extracts_selected_context_and_bounded_occupancy() {
        initialize();
        let replay = r#"{
            "summary":{"ticks_recorded":2},
            "game_meta":{"players":{"0":{"damage_dealt":12}}},
            "events":[{"type":"kill"},"scalar"],
            "ticks":[
                {"game_type":"slayer","game_time_info":{"ticks":10},"players":[
                    {"player_index":0,"name":"A","player_object_data":{"x":-0.1,"y":1,"z":1.49}},
                    {"player_index":1,"derived_stats":{"is_hostman":true},"player_object_data":{"x":2,"y":3,"z":4}}
                ]},
                {"game_type":"slayer","players":[
                    {"player_index":0,"kills":1,"player_object_data":{"x":-0.1,"y":1,"z":1.49}},
                    {"player_index":2}
                ]}
            ]
        }"#;
        let output = extract_replay(Cursor::new(replay)).expect("extract replay");

        assert_eq!(output.tick_count, 2);
        assert_eq!(output.event_count, 2);
        assert_eq!(output.event_sample.len(), 2);
        assert_eq!(output.spatial_occupancy.samples_seen, 4);
        assert_eq!(output.spatial_occupancy.cells.len(), 1);
        assert_eq!(output.spatial_occupancy.cells[0].cell, [-1, 2, 2]);
        assert_eq!(output.spatial_occupancy.cells[0].observed_ticks, 2);
        assert_eq!(output.spatial_occupancy.discarded["hostman"], 1);
        assert_eq!(
            output.spatial_occupancy.discarded["missing_player_object"],
            1
        );
    }

    #[test]
    fn distinguishes_missing_and_invalid_coordinates() {
        initialize();
        let replay = r#"{"ticks":[{"players":[
            {"player_index":0,"player_object_data":{"x":1,"y":2}},
            {"player_index":1,"player_object_data":{"x":null,"y":2,"z":3}},
            {"player_index":"bad","player_object_data":{"x":1,"y":2,"z":3}}
        ]}]}"#;
        let output = extract_replay(Cursor::new(replay)).expect("extract replay");

        assert_eq!(output.spatial_occupancy.discarded["missing_coordinate"], 1);
        assert_eq!(output.spatial_occupancy.discarded["non_finite"], 1);
        assert_eq!(output.spatial_occupancy.discarded["invalid_slot"], 1);
    }
}
