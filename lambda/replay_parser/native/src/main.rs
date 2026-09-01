mod viewer;

use flate2::read::GzDecoder;
use serde::de::{Error as DeError, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::value::RawValue;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::error::Error;
use std::fmt;
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const OUTPUT_SCHEMA: &str = "halospawns.replayExtractor.v1";
const MAX_COORDINATE_ABS: f64 = 1_000_000.0;
const MAX_CELLS_PER_SLOT: usize = 50_000;
const MAX_CELLS_TOTAL: usize = 200_000;
const MAX_COUNTER: u64 = 2_147_483_647;
const MAX_EVENT_SAMPLE: usize = 10;
const MAX_SPAWN_POINTS: usize = 512;
const BUFFER_SIZE: usize = 1024 * 1024;
const MAX_DECOMPRESSED_REPLAY_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_SOURCE_WORKERS: usize = 8;
const SOURCE_WORK_WINDOW_MULTIPLIER: usize = 2;
const DEFAULT_VIEWER_INGEST_QUEUE_TICKS: usize = 64;
const MAX_VIEWER_INGEST_QUEUE_TICKS: usize = 512;
const DECOMPRESSION_PIPE_CHUNKS: usize = 4;

static CELL_SIZE: OnceLock<f64> = OnceLock::new();

struct BoundedReader<R> {
    inner: R,
    bytes_read: u64,
    max_bytes: u64,
}

impl<R> BoundedReader<R> {
    fn new(inner: R, max_bytes: u64) -> Self {
        Self {
            inner,
            bytes_read: 0,
            max_bytes,
        }
    }
}

impl<R: Read> Read for BoundedReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.bytes_read >= self.max_bytes {
            let mut probe = [0_u8; 1];
            return match self.inner.read(&mut probe)? {
                0 => Ok(0),
                _ => Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "replay JSON exceeds the decompressed size limit",
                )),
            };
        }
        let remaining = self.max_bytes - self.bytes_read;
        let bounded_length = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| io::Error::other("replay size limit is unsupported"))?;
        let bytes_read = self.inner.read(&mut buffer[..bounded_length])?;
        self.bytes_read += bytes_read as u64;
        Ok(bytes_read)
    }
}

struct PipelinedReader {
    chunks: Receiver<io::Result<Vec<u8>>>,
    current: Vec<u8>,
    offset: usize,
    worker: Option<JoinHandle<()>>,
    finished: bool,
}

impl PipelinedReader {
    fn spawn<R>(mut source: R) -> Self
    where
        R: Read + Send + 'static,
    {
        let (sender, chunks) = mpsc::sync_channel(DECOMPRESSION_PIPE_CHUNKS);
        let worker = thread::spawn(move || {
            loop {
                let mut chunk = vec![0_u8; BUFFER_SIZE];
                match source.read(&mut chunk) {
                    Ok(0) => return,
                    Ok(bytes_read) => {
                        chunk.truncate(bytes_read);
                        if sender.send(Ok(chunk)).is_err() {
                            return;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        return;
                    }
                }
            }
        });
        Self {
            chunks,
            current: Vec::new(),
            offset: 0,
            worker: Some(worker),
            finished: false,
        }
    }

    fn finish_worker(&mut self) -> io::Result<()> {
        self.finished = true;
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| io::Error::other("decompression worker panicked"))?;
        }
        Ok(())
    }
}

impl Read for PipelinedReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() || self.finished {
            return Ok(0);
        }
        while self.offset >= self.current.len() {
            match self.chunks.recv() {
                Ok(Ok(chunk)) => {
                    self.current = chunk;
                    self.offset = 0;
                }
                Ok(Err(error)) => {
                    self.finish_worker()?;
                    return Err(error);
                }
                Err(_) => {
                    self.finish_worker()?;
                    return Ok(0);
                }
            }
        }
        let bytes_read = output.len().min(self.current.len() - self.offset);
        output[..bytes_read].copy_from_slice(&self.current[self.offset..self.offset + bytes_read]);
        self.offset += bytes_read;
        Ok(bytes_read)
    }
}

impl Drop for PipelinedReader {
    fn drop(&mut self) {
        if !self.finished {
            let (_, replacement) = mpsc::channel();
            self.chunks = replacement;
            let _ = self.finish_worker();
        }
    }
}

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
    network_game_object: Value,
    #[serde(default)]
    game_engine_has_teams: CapturedValue,
    #[serde(default)]
    has_teams: CapturedValue,
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
    worker_parse_duration: Duration,
    worker_projection_duration: Duration,
    worker_facts_duration: Duration,
    viewer_ingest_duration: Duration,
}

impl Ticks {
    fn absorb(&mut self, tick: Tick) {
        let tick_index = self.count;
        self.count = self.count.saturating_add(1);
        if self.first_network_game_client.is_none()
            && let Some(mapping) = tick.network_game_client.object()
            && !mapping.is_empty()
        {
            self.first_network_game_client = Some(Value::Object(mapping.clone()));
        }
        if self.spawn_points.is_empty() && tick.spawns.present {
            let points = spawn_points_from_records(&tick.spawns.value);
            if !points.is_empty() {
                self.spawn_points = points;
                self.spawn_source_path = Some(format!("$.ticks[{tick_index}].spawns"));
            }
        }
        for player in &tick.players {
            self.occupancy.observe(player);
        }
        let selected = tick.selected_value();
        if self.first.is_none() {
            self.first = Some(selected.clone());
        }
        self.last = Some(selected);
    }
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
    viewer_values: Vec<Value>,
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

struct TickTask {
    index: u64,
    raw: Box<RawValue>,
}

struct ParsedTick {
    tick: Tick,
    projected: Option<(Value, [u8; 32])>,
    parse_duration: Duration,
    projection_duration: Duration,
    facts_duration: Duration,
}

struct TickWorkMessage {
    index: u64,
    result: Result<ParsedTick, String>,
}

fn configured_source_worker_count() -> Result<usize, Box<dyn Error>> {
    let Some(value) = env::var_os("REPLAY_SOURCE_WORKERS") else {
        return Ok(1);
    };
    let worker_count = value
        .to_str()
        .ok_or("REPLAY_SOURCE_WORKERS must be UTF-8")?
        .parse::<usize>()?;
    if !(1..=MAX_SOURCE_WORKERS).contains(&worker_count) {
        return Err(
            format!("REPLAY_SOURCE_WORKERS must be between 1 and {MAX_SOURCE_WORKERS}").into(),
        );
    }
    Ok(worker_count)
}

fn configured_viewer_ingest_queue_ticks() -> Result<usize, Box<dyn Error>> {
    let Some(value) = env::var_os("VIEWER_INGEST_QUEUE_TICKS") else {
        return Ok(DEFAULT_VIEWER_INGEST_QUEUE_TICKS);
    };
    let queue_ticks = value
        .to_str()
        .ok_or("VIEWER_INGEST_QUEUE_TICKS must be UTF-8")?
        .parse::<usize>()?;
    if !(1..=MAX_VIEWER_INGEST_QUEUE_TICKS).contains(&queue_ticks) {
        return Err(format!(
            "VIEWER_INGEST_QUEUE_TICKS must be between 1 and {MAX_VIEWER_INGEST_QUEUE_TICKS}"
        )
        .into());
    }
    Ok(queue_ticks)
}

fn pipelined_decompression_enabled() -> Result<bool, Box<dyn Error>> {
    let Some(value) = env::var_os("REPLAY_PIPELINED_DECOMPRESSION") else {
        return Ok(true);
    };
    match value
        .to_str()
        .ok_or("REPLAY_PIPELINED_DECOMPRESSION must be UTF-8")?
    {
        "1" | "true" => Ok(true),
        "0" | "false" => Ok(false),
        _ => Err("REPLAY_PIPELINED_DECOMPRESSION must be true, false, 1, or 0".into()),
    }
}

fn process_tick_task(task: TickTask, viewer_enabled: bool) -> TickWorkMessage {
    let result = (|| -> Result<ParsedTick, Box<dyn Error>> {
        let parse_started = Instant::now();
        let source = serde_json::from_str::<Value>(task.raw.get())?;
        let parse_duration = parse_started.elapsed();
        let (projected, projection_duration) = if viewer_enabled {
            let (projected, semantic_digest, duration) = viewer::project_tick(&source)?;
            (Some((projected, semantic_digest)), duration)
        } else {
            (None, Duration::ZERO)
        };
        let facts_started = Instant::now();
        let tick = serde_json::from_value(source)?;
        Ok(ParsedTick {
            tick,
            projected,
            parse_duration,
            projection_duration,
            facts_duration: facts_started.elapsed(),
        })
    })()
    .map_err(|error| error.to_string());
    TickWorkMessage {
        index: task.index,
        result,
    }
}

fn tick_worker(
    tasks: Arc<Mutex<Receiver<TickTask>>>,
    results: SyncSender<TickWorkMessage>,
    viewer_enabled: bool,
) {
    loop {
        let task = match tasks.lock() {
            Ok(tasks) => tasks.recv(),
            Err(_) => return,
        };
        let Ok(task) = task else {
            return;
        };
        if results
            .send(process_tick_task(task, viewer_enabled))
            .is_err()
        {
            return;
        }
    }
}

struct TickWorkerPool {
    task_sender: Option<SyncSender<TickTask>>,
    result_receiver: Option<Receiver<TickWorkMessage>>,
    worker_handles: Vec<JoinHandle<()>>,
}

struct ViewerIngestTask {
    projected: Value,
    semantic_digest: [u8; 32],
    projection_duration: Duration,
}

struct ViewerIngestWorker {
    task_sender: Option<SyncSender<ViewerIngestTask>>,
    result_receiver: Receiver<Result<(), String>>,
    handle: Option<JoinHandle<()>>,
    dispatched: u64,
    completed: u64,
}

impl ViewerIngestWorker {
    fn new(capacity: usize) -> Self {
        let (task_sender, task_receiver) = mpsc::sync_channel::<ViewerIngestTask>(capacity);
        let (result_sender, result_receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            while let Ok(task) = task_receiver.recv() {
                let result = viewer::add_projected_tick(
                    task.projected,
                    task.semantic_digest,
                    task.projection_duration,
                )
                .map_err(|error| error.to_string());
                let failed = result.is_err();
                if result_sender.send(result).is_err() || failed {
                    return;
                }
            }
        });
        Self {
            task_sender: Some(task_sender),
            result_receiver,
            handle: Some(handle),
            dispatched: 0,
            completed: 0,
        }
    }

    fn absorb_result(&mut self, result: Result<(), String>) -> Result<(), Box<dyn Error>> {
        self.completed = self
            .completed
            .checked_add(1)
            .ok_or("viewer ingest completion count overflow")?;
        result.map_err(|error| format!("viewer ingest worker failed: {error}").into())
    }

    fn collect_ready(&mut self) -> Result<(), Box<dyn Error>> {
        loop {
            match self.result_receiver.try_recv() {
                Ok(result) => self.absorb_result(result)?,
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) if self.completed == self.dispatched => {
                    return Ok(());
                }
                Err(TryRecvError::Disconnected) => {
                    return Err("viewer ingest worker stopped before completing all ticks".into());
                }
            }
        }
    }

    fn send(
        &mut self,
        projected: Value,
        semantic_digest: [u8; 32],
        projection_duration: Duration,
    ) -> Result<(), Box<dyn Error>> {
        self.collect_ready()?;
        self.task_sender
            .as_ref()
            .ok_or("viewer ingest worker is already closed")?
            .send(ViewerIngestTask {
                projected,
                semantic_digest,
                projection_duration,
            })
            .map_err(|_| "viewer ingest worker queue closed unexpectedly")?;
        self.dispatched = self
            .dispatched
            .checked_add(1)
            .ok_or("viewer ingest dispatch count overflow")?;
        self.collect_ready()
    }

    fn finish(&mut self) -> Result<(), Box<dyn Error>> {
        self.task_sender.take();
        while self.completed < self.dispatched {
            let result = self
                .result_receiver
                .recv()
                .map_err(|_| "viewer ingest worker stopped before completing all ticks")?;
            self.absorb_result(result)?;
        }
        if let Some(handle) = self.handle.take() {
            handle.join().map_err(|_| "viewer ingest worker panicked")?;
        }
        Ok(())
    }
}

impl Drop for ViewerIngestWorker {
    fn drop(&mut self) {
        self.task_sender.take();
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl TickWorkerPool {
    fn new(worker_count: usize, viewer_enabled: bool) -> Self {
        let queue_capacity = worker_count * SOURCE_WORK_WINDOW_MULTIPLIER;
        let (task_sender, task_receiver) = mpsc::sync_channel(queue_capacity);
        let task_receiver = Arc::new(Mutex::new(task_receiver));
        let (result_sender, result_receiver) = mpsc::sync_channel(queue_capacity);
        let worker_handles = (0..worker_count)
            .map(|_| {
                let tasks = Arc::clone(&task_receiver);
                let results = result_sender.clone();
                thread::spawn(move || tick_worker(tasks, results, viewer_enabled))
            })
            .collect();
        drop(result_sender);
        Self {
            task_sender: Some(task_sender),
            result_receiver: Some(result_receiver),
            worker_handles,
        }
    }

    fn send(&self, task: TickTask) -> Result<(), Box<dyn Error>> {
        self.task_sender
            .as_ref()
            .ok_or("replay source workers are already closed")?
            .send(task)
            .map_err(|_| "replay source worker queue closed unexpectedly".into())
    }

    fn take_result_receiver(&mut self) -> Result<Receiver<TickWorkMessage>, Box<dyn Error>> {
        self.result_receiver
            .take()
            .ok_or_else(|| "replay source result receiver was already taken".into())
    }

    fn close(&mut self) {
        self.task_sender.take();
    }

    fn join(&mut self) -> Result<(), Box<dyn Error>> {
        for handle in self.worker_handles.drain(..) {
            handle.join().map_err(|_| "replay source worker panicked")?;
        }
        Ok(())
    }
}

impl Drop for TickWorkerPool {
    fn drop(&mut self) {
        self.task_sender.take();
        for handle in self.worker_handles.drain(..) {
            let _ = handle.join();
        }
    }
}

fn absorb_ready_ticks(
    output: &mut Ticks,
    pending: &mut BTreeMap<u64, Result<ParsedTick, String>>,
    next_index: &mut u64,
    viewer_ingest: &mut Option<ViewerIngestWorker>,
) -> Result<(), Box<dyn Error>> {
    while let Some(result) = pending.remove(next_index) {
        let parsed = result.map_err(|error| format!("replay tick {next_index}: {error}"))?;
        output.worker_parse_duration += parsed.parse_duration;
        output.worker_projection_duration += parsed.projection_duration;
        output.worker_facts_duration += parsed.facts_duration;
        if let Some((projected, semantic_digest)) = parsed.projected {
            let ingest_started = Instant::now();
            if let Some(viewer_ingest) = viewer_ingest {
                viewer_ingest.send(projected, semantic_digest, parsed.projection_duration)?;
            } else {
                viewer::add_projected_tick(projected, semantic_digest, parsed.projection_duration)?;
            }
            output.viewer_ingest_duration += ingest_started.elapsed();
        }
        output.absorb(parsed.tick);
        *next_index = next_index
            .checked_add(1)
            .ok_or("replay tick index overflow")?;
    }
    Ok(())
}

struct TickReduction {
    output: Ticks,
    reducer_duration: Duration,
}

fn reduce_tick_results(
    results: Receiver<TickWorkMessage>,
    viewer_enabled: bool,
    viewer_ingest_queue_ticks: usize,
) -> Result<TickReduction, String> {
    let mut output = Ticks::default();
    let mut pending = BTreeMap::new();
    let mut next_index = 0_u64;
    let mut viewer_ingest =
        viewer_enabled.then(|| ViewerIngestWorker::new(viewer_ingest_queue_ticks));
    let mut reducer_duration = Duration::ZERO;
    let mut first_error = None;

    while let Ok(message) = results.recv() {
        if first_error.is_some() {
            continue;
        }
        let started = Instant::now();
        let result = if pending.insert(message.index, message.result).is_some() {
            Err("replay source workers returned a duplicate tick".into())
        } else {
            absorb_ready_ticks(
                &mut output,
                &mut pending,
                &mut next_index,
                &mut viewer_ingest,
            )
            .map_err(|error| error.to_string())
        };
        reducer_duration += started.elapsed();
        if let Err(error) = result {
            first_error = Some(error);
            pending.clear();
        }
    }

    if let Some(error) = first_error {
        return Err(error);
    }
    if !pending.is_empty() {
        return Err("replay source workers returned a non-contiguous tick sequence".into());
    }
    if let Some(viewer_ingest) = viewer_ingest.as_mut() {
        let started = Instant::now();
        viewer_ingest.finish().map_err(|error| error.to_string())?;
        reducer_duration += started.elapsed();
    }
    Ok(TickReduction {
        output,
        reducer_duration,
    })
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
        let worker_count = configured_source_worker_count().map_err(A::Error::custom)?;
        if worker_count == 1 {
            while let Some(raw_tick) = sequence.next_element::<Value>()? {
                viewer::add_tick(&raw_tick).map_err(A::Error::custom)?;
                output.absorb(serde_json::from_value(raw_tick).map_err(A::Error::custom)?);
            }
            return Ok(output);
        }

        let viewer_enabled = viewer::enabled();
        let viewer_ingest_queue_ticks =
            configured_viewer_ingest_queue_ticks().map_err(A::Error::custom)?;
        let mut pool = TickWorkerPool::new(worker_count, viewer_enabled);
        let results = pool.take_result_receiver().map_err(A::Error::custom)?;
        let reducer_handle = thread::spawn(move || {
            reduce_tick_results(results, viewer_enabled, viewer_ingest_queue_ticks)
        });
        let pipeline_started = Instant::now();
        let mut framing_duration = Duration::ZERO;
        let mut submitted = 0_u64;
        let mut source_error = None;
        let mut pipeline_error = None;

        loop {
            let framing_started = Instant::now();
            let raw = match sequence.next_element::<Box<RawValue>>() {
                Ok(Some(raw)) => raw,
                Ok(None) => {
                    framing_duration += framing_started.elapsed();
                    break;
                }
                Err(error) => {
                    framing_duration += framing_started.elapsed();
                    source_error = Some(error);
                    break;
                }
            };
            framing_duration += framing_started.elapsed();
            if let Err(error) = pool.send(TickTask {
                index: submitted,
                raw,
            }) {
                pipeline_error = Some(error.to_string());
                break;
            }
            submitted = submitted
                .checked_add(1)
                .ok_or_else(|| A::Error::custom("replay tick count overflow"))?;
        }

        pool.close();
        let worker_result = pool.join();
        let reduction = reducer_handle
            .join()
            .map_err(|_| A::Error::custom("replay tick reducer panicked"))?
            .map_err(A::Error::custom)?;
        worker_result.map_err(A::Error::custom)?;
        if reduction.output.count != submitted {
            return Err(A::Error::custom(
                "replay source workers returned an incomplete tick sequence",
            ));
        }
        if let Some(error) = pipeline_error {
            return Err(A::Error::custom(error));
        }
        if let Some(error) = source_error {
            return Err(error);
        }
        if env::var_os("REPLAY_PROFILE").is_some() {
            eprintln!(
                "replay-source-profile workers={worker_count} wall_ms={} framing_ms={} reducer_ms={} parse_cpu_ms={} projection_cpu_ms={} facts_cpu_ms={} viewer_ingest_ms={}",
                pipeline_started.elapsed().as_millis(),
                framing_duration.as_millis(),
                reduction.reducer_duration.as_millis(),
                reduction.output.worker_parse_duration.as_millis(),
                reduction.output.worker_projection_duration.as_millis(),
                reduction.output.worker_facts_duration.as_millis(),
                reduction.output.viewer_ingest_duration.as_millis(),
            );
        }
        Ok(reduction.output)
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
                output.sample.push(event.clone());
            }
            if viewer::enabled() {
                if output.viewer_values.len() >= 200_000 {
                    return Err(A::Error::custom(
                        "viewer replay events exceed the pinned contract limit",
                    ));
                }
                if event.is_array() || event.is_object() || event.is_null() {
                    return Err(A::Error::custom(
                        "viewer replay events must contain non-null scalars",
                    ));
                }
                output.viewer_values.push(event);
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
    let mut viewer_source = Map::new();
    for (key, value) in [
        ("summary", &replay.summary),
        ("game_meta", &replay.game_meta),
        ("network_game_client", &replay.network_game_client),
        ("network_game_object", &replay.network_game_object),
    ] {
        if !value.is_null() {
            viewer_source.insert(key.to_owned(), value.clone());
        }
    }
    for (key, captured) in [
        ("game_engine_has_teams", &replay.game_engine_has_teams),
        ("has_teams", &replay.has_teams),
    ] {
        if captured.present && !captured.value.is_null() {
            viewer_source.insert(key.to_owned(), captured.value.clone());
        }
    }
    if viewer::enabled() {
        viewer_source.insert(
            "events".to_owned(),
            Value::Array(replay.events.viewer_values.clone()),
        );
    }
    viewer::finish(&viewer_source)?;
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
        let decoder = zstd::stream::read::Decoder::new(File::open(path)?)?;
        return if pipelined_decompression_enabled()? {
            Ok(Box::new(PipelinedReader::spawn(decoder)))
        } else {
            Ok(Box::new(decoder))
        };
    }
    if bytes_read >= 2 && magic[..2] == [0x1f, 0x8b] {
        let decoder = GzDecoder::new(BufReader::with_capacity(BUFFER_SIZE, File::open(path)?));
        return if pipelined_decompression_enabled()? {
            Ok(Box::new(PipelinedReader::spawn(decoder)))
        } else {
            Ok(Box::new(decoder))
        };
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

enum Command {
    Extract {
        input: PathBuf,
        output: PathBuf,
        cell_size: f64,
        viewer_parts: Option<PathBuf>,
    },
    FinalizeViewer {
        viewer_parts: PathBuf,
        viewer_manifest: PathBuf,
        viewer_output: PathBuf,
        viewer_result: PathBuf,
    },
}

fn parse_args() -> Result<Command, Box<dyn Error>> {
    let mut input = None;
    let mut output = None;
    let mut cell_size = 0.5;
    let mut viewer_parts = None;
    let mut finalize_viewer = false;
    let mut viewer_manifest = None;
    let mut viewer_output = None;
    let mut viewer_result = None;
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--input" => input = args.next().map(PathBuf::from),
            "--output" => output = args.next().map(PathBuf::from),
            "--cell-size" => {
                cell_size = args.next().ok_or("--cell-size requires a value")?.parse()?;
            }
            "--viewer-parts" => viewer_parts = args.next().map(PathBuf::from),
            "--finalize-viewer" => finalize_viewer = true,
            "--viewer-manifest" => viewer_manifest = args.next().map(PathBuf::from),
            "--viewer-output" => viewer_output = args.next().map(PathBuf::from),
            "--viewer-result" => viewer_result = args.next().map(PathBuf::from),
            _ => return Err(format!("unknown argument: {argument}").into()),
        }
    }
    if finalize_viewer {
        if input.is_some() || output.is_some() {
            return Err("viewer finalization does not accept --input or --output".into());
        }
        return Ok(Command::FinalizeViewer {
            viewer_parts: viewer_parts.ok_or("--viewer-parts is required")?,
            viewer_manifest: viewer_manifest.ok_or("--viewer-manifest is required")?,
            viewer_output: viewer_output.ok_or("--viewer-output is required")?,
            viewer_result: viewer_result.ok_or("--viewer-result is required")?,
        });
    }
    if viewer_manifest.is_some() || viewer_output.is_some() || viewer_result.is_some() {
        return Err("viewer finalization arguments require --finalize-viewer".into());
    }
    if !matches!(cell_size, 0.5 | 1.0) {
        return Err("--cell-size must be 0.5 or 1.0".into());
    }
    Ok(Command::Extract {
        input: input.ok_or("--input is required")?,
        output: output.ok_or("--output is required")?,
        cell_size,
        viewer_parts,
    })
}

fn run() -> Result<(), Box<dyn Error>> {
    match parse_args()? {
        Command::Extract {
            input,
            output,
            cell_size,
            viewer_parts,
        } => {
            CELL_SIZE
                .set(cell_size)
                .map_err(|_| "cell size was already initialized")?;
            if let Some(directory) = viewer_parts {
                viewer::configure(&directory)?;
            }
            let extracted = extract_replay(BoundedReader::new(
                input_reader(&input)?,
                MAX_DECOMPRESSED_REPLAY_BYTES,
            ))?;
            let file = File::create(output)?;
            let mut writer = BufWriter::with_capacity(BUFFER_SIZE, file);
            serde_json::to_writer(&mut writer, &extracted)?;
            writer.write_all(b"\n")?;
            writer.flush()?;
        }
        Command::FinalizeViewer {
            viewer_parts,
            viewer_manifest,
            viewer_output,
            viewer_result,
        } => {
            let result =
                viewer::finalize_container(&viewer_parts, &viewer_manifest, &viewer_output)?;
            let file = File::create(viewer_result)?;
            let mut writer = BufWriter::with_capacity(BUFFER_SIZE, file);
            serde_json::to_writer(&mut writer, &result)?;
            writer.write_all(b"\n")?;
            writer.flush()?;
        }
    }
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

    fn raw_tick(value: &str) -> Box<RawValue> {
        RawValue::from_string(value.to_owned()).expect("valid raw tick")
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
    fn bounded_reader_rejects_decompressed_input_over_its_limit() {
        let mut reader = BoundedReader::new(Cursor::new(b"four"), 3);
        let mut output = Vec::new();
        assert!(reader.read_to_end(&mut output).is_err());
        assert_eq!(output, b"fou");
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

    #[test]
    fn source_workers_reduce_ticks_in_source_order() {
        initialize();
        let mut pool = TickWorkerPool::new(4, false);
        let results = pool.take_result_receiver().expect("take results");
        let reducer = thread::spawn(move || reduce_tick_results(results, false, 1));
        for (index, game_type) in ["first", "middle", "last"].into_iter().enumerate() {
            pool.send(TickTask {
                index: index as u64,
                raw: raw_tick(&format!(
                    r#"{{"current_tick":{index},"game_type":"{game_type}","players":[]}}"#
                )),
            })
            .expect("queue tick");
        }
        pool.close();
        pool.join().expect("join workers");
        let output = reducer
            .join()
            .expect("join reducer")
            .expect("reduce ticks")
            .output;

        assert_eq!(output.count, 3);
        assert_eq!(output.first.as_ref().unwrap()["game_type"], "first");
        assert_eq!(output.last.as_ref().unwrap()["game_type"], "last");
    }

    #[test]
    fn ordered_reducer_reports_the_earliest_worker_error() {
        let first = process_tick_task(
            TickTask {
                index: 0,
                raw: raw_tick(r#"{"players":{}}"#),
            },
            true,
        );
        let second = process_tick_task(
            TickTask {
                index: 1,
                raw: raw_tick(r#"{"players":[]}"#),
            },
            true,
        );
        let (sender, results) = mpsc::sync_channel(2);
        sender.send(second).expect("send later result");
        sender.send(first).expect("send earlier result");
        drop(sender);
        let error = match reduce_tick_results(results, false, 1) {
            Ok(_) => panic!("first tick must fail"),
            Err(error) => error,
        };
        assert!(error.starts_with("replay tick 0:"));
    }
}
