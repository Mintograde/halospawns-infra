mod analytics;
mod counters;
mod artifact;
mod fast_schema;
mod native;
mod combat;
mod recycle;
mod sampling;
mod text_equal;
mod transport;

use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Write};
use std::path::Path;
use std::time::Instant;

#[derive(Deserialize)]
struct Request {
    ticks: usize,
    players: usize,
    map: String,
    replay_id: String,
    recorded_at: String,
    #[serde(default)]
    analytics_context: Option<Value>,
    #[serde(default = "default_level")]
    zstd_level: i32,
    #[serde(default = "default_source_tick_rate")]
    source_tick_rate: u32,
    #[serde(default = "default_export_contract")]
    export_contract: String,
    #[serde(default = "default_export_contract")]
    transport_contract: String,
    #[serde(default = "default_analytics_revision")]
    analytics_revision: u8,
    #[serde(default)]
    combat_network_recording: bool,
    #[serde(default = "default_viewer_revision")]
    viewer_profile_revision: u32,
    #[serde(default)]
    source_viewer_only: bool,
    #[serde(default = "default_incremental_state")]
    incremental_state: bool,
    #[serde(default = "default_incremental_state")]
    typed_poses: bool,
    #[serde(default)]
    verify_incremental_state: bool,
}
fn default_analytics_revision() -> u8 {
    2
}
fn default_viewer_revision() -> u32 {
    4
}
fn default_level() -> i32 {
    6
}
fn default_source_tick_rate() -> u32 {
    120
}
fn default_export_contract() -> String {
    "HSFT0001".into()
}
fn default_incremental_state() -> bool {
    true
}

impl Request {
    fn validate(&self) -> Result<(), Box<dyn Error>> {
        if !(1..=432_000).contains(&self.ticks) || !(1..=h1_pose_codec::MAX_PLAYERS).contains(&self.players) {
            return Err("invalid request tick or player count".into());
        }
        // Keep the original adapter's timer/score semantics. A future source ABI
        // or rate needs an explicit encoder adapter, not silent reinterpretation.
        if self.source_tick_rate != 120 || self.export_contract != "HSFT0001" {
            return Err("unsupported engine rate or export contract".into());
        }
        if !matches!(self.transport_contract.as_str(), "HSFT0001" | "HSFT0002") {
            return Err("unsupported engine transport contract".into());
        }
        if !(1..=4).contains(&self.analytics_revision) {
            return Err("unsupported analytics revision".into());
        }
        Ok(())
    }
}

#[derive(Default)]
struct Observations {
    legacy_analytics: bool,
    first_clock: Option<u64>,
    last_clock: Option<u64>,
    players: BTreeSet<u64>,
    object_types: BTreeSet<u64>,
    max_objects: usize,
    max_shots: u64,
    max_deaths: u64,
    previous: BTreeMap<u64, counters::Counters>,
    initial_counters: BTreeMap<u64, counters::Counters>,
    last_body: BTreeMap<u64, i64>,
    body_replacements: usize,
    events: Vec<ObservedEvent>,
    event_bytes: usize,
    series: BTreeMap<u64, BTreeMap<&'static str, BTreeMap<usize, Value>>>,
    metric_points: usize,
    final_meta: Map<String, Value>,
    match_end_source_tick: Option<usize>,
}

const SCORE_FIELDS: &[&str] = &[
    "kills",
    "deaths",
    "assists",
    "suicides",
    "team_kills",
    "score",
    "ctf_score",
    "shots_fired",
    "shots_hit",
];

#[derive(serde::Serialize)]
struct ObservedEvent {
    source_tick: usize,
    time_seconds: f64,
    description: String,
}

impl Observations {
    fn freeze_statistics(&self, tick: &mut Value, postgame: bool) {
        if let Some(players) = tick["players"].as_array_mut() {
            for player in players {
                let counters = player["player_index"]
                    .as_u64()
                    .and_then(|id| self.previous.get(&id));
                for &field in SCORE_FIELDS {
                    // The end flag is exported after the update. Scoring counters
                    // are engine-gated; PGCR shots and damage are not. Preserve
                    // the winning score, but exclude end-tick postgame activity.
                    if !postgame && !matches!(field, "shots_fired" | "shots_hit") {
                        continue;
                    }
                    if let Some(value) = counters.and_then(|before| before.get(field)) {
                        player[field] = value.clone();
                    } else if let Some(player) = player.as_object_mut() {
                        player.remove(field);
                    }
                }
            }
        }
        if !self.final_meta.is_empty() {
            tick["game_meta"] = json!(self.final_meta);
        } else if let Some(players) = tick["game_meta"]["players"].as_object_mut() {
            // A film starting in postgame has no observed in-match PGCR baseline.
            for player in players.values_mut().filter_map(Value::as_object_mut) {
                for field in [
                    "damage_dealt",
                    "damage_received",
                    "camo_count",
                    "overshield_count",
                ] {
                    player.remove(field);
                }
            }
        }
    }

    fn event(&mut self, ordinal: usize, description: String) -> Result<(), Box<dyn Error>> {
        if self.events.len() >= 200_000 {
            return Err("events exceed the replay contract limit".into());
        }
        self.event_bytes += description.len() + 32;
        if self.event_bytes > 8 * 1024 * 1024 {
            return Err("events exceed the local 8 MiB metadata budget".into());
        }
        self.events.push(ObservedEvent {
            source_tick: ordinal,
            time_seconds: ordinal as f64 / 120.0,
            description,
        });
        Ok(())
    }

    #[cfg(test)]
    fn observe(
        &mut self,
        tick: &mut Value,
        ordinal: usize,
        seats: usize,
    ) -> Result<(), Box<dyn Error>> {
        self.observe_state(tick, ordinal, seats, None)
    }

    fn observe_state(
        &mut self,
        tick: &mut Value,
        ordinal: usize,
        seats: usize,
        objects: Option<&transport::ObjectState>,
    ) -> Result<(), Box<dyn Error>> {
        let clock = tick["current_tick"].as_u64().ok_or("missing engine tick")?;
        if self.last_clock.is_some_and(|last| clock != last + 1) {
            return Err("engine clock skipped or repeated a tick".into());
        }
        if self.first_clock.is_none() {
            self.first_clock = Some(clock);
        }
        self.last_clock = Some(clock);
        if ordinal == 0 {
            self.event(ordinal, "Game recording started".into())?;
        }
        let postgame = self.match_end_source_tick.is_some() && !self.legacy_analytics;
        let ends_now = tick["game_ended_this_tick"].as_bool() == Some(true)
            && self.match_end_source_tick.is_none();
        if !self.legacy_analytics && (postgame || ends_now) {
            self.freeze_statistics(tick, postgame);
        }
        let players = tick["players"].as_array().ok_or("missing players")?;
        if players.len() > h1_pose_codec::MAX_PLAYERS || (ordinal == 0 && players.len() != seats) {
            return Err("film roster does not match engine export".into());
        }
        let mut ids = BTreeSet::new();
        for player in players {
            let id = player["player_index"]
                .as_u64()
                .ok_or("missing player index")?;
            if !ids.insert(id) {
                return Err("duplicate player index".into());
            }
            self.players.insert(id);
            if let Some(body) = player["player_object_id"]
                .as_i64()
                .filter(|body| *body != -1)
            {
                if self
                    .last_body
                    .insert(id, body)
                    .is_some_and(|before| before != body)
                {
                    self.body_replacements += 1;
                }
            }
            self.max_shots = self
                .max_shots
                .max(player["shots_fired"].as_u64().unwrap_or(0));
            self.max_deaths = self.max_deaths.max(player["deaths"].as_u64().unwrap_or(0));
            if postgame {
                continue;
            }
            // Observe counters at 120 Hz before decimation; do not guess killer/victim pairs.
            let counters = counters::Counters::from_player(
                player,
                &tick["game_meta"]["players"][id.to_string()],
            );
            if ordinal == 0 {
                self.initial_counters.insert(id, counters.clone());
            }
            let before = self.previous.remove(&id);
            let name = player["name"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("Player {id}"));
            if let Some(before) = &before {
                for (counter, metric) in sampling::METRICS {
                    if let (Some(old), Some(now)) =
                        (before[counter].as_f64(), counters[counter].as_f64())
                    {
                        let delta = now - old;
                        if delta <= 0.0 {
                            continue;
                        }
                        self.metric_points += 1;
                        if self.metric_points > 200_000 {
                            return Err("chart points exceed the local metadata budget".into());
                        }
                        let value = if matches!(counter, "kills" | "deaths") {
                            if delta > 64.0 || delta.fract() != 0.0 {
                                return Err("invalid kill/death delta".into());
                            }
                            let body = &player["player_object_data"];
                            json!(vec![
                                json!([body["x"], body["y"], body["z"]]);
                                delta as usize
                            ])
                        } else {
                            json!(delta)
                        };
                        self.series
                            .entry(id)
                            .or_default()
                            .entry(metric)
                            .or_default()
                            .insert(ordinal, value);
                        if counter == "damage_received" {
                            self.event(ordinal, format!("{name} was damaged ({delta:.2} points)"))?;
                        }
                    }
                }
                for (key, description) in [
                    ("kills", "got a kill"),
                    ("deaths", "died"),
                    ("assists", "got an assist"),
                    ("suicides", "committed suicide"),
                    ("team_kills", "team-killed"),
                ] {
                    if let (Some(old), Some(now)) = (before[key].as_u64(), counters[key].as_u64()) {
                        for value in old + 1..=now {
                            self.event(ordinal, format!("{name} {description} ({value})"))?;
                        }
                    }
                }
                for (key, item) in [("camo_count", "camo"), ("overshield_count", "overshield")] {
                    if let (Some(old), Some(now)) = (before[key].as_u64(), counters[key].as_u64()) {
                        for _ in old..now {
                            self.event(ordinal, format!("{name} picked up {item}"))?;
                        }
                    }
                }
                if (!ends_now || self.legacy_analytics)
                    && counters["unit"].as_u64().is_some()
                    && before["unit"] == counters["unit"]
                {
                    for (key, item) in [
                        ("primary_nades", "frag grenade"),
                        ("secondary_nades", "plasma grenade"),
                    ] {
                        if let (Some(old), Some(now)) =
                            (before[key].as_u64(), counters[key].as_u64())
                        {
                            for _ in now..old {
                                self.event(ordinal, format!("{name} threw a {item}"))?;
                            }
                        }
                    }
                }
            }
            if (!ends_now || self.legacy_analytics)
                && counters["unit"].as_u64().is_some()
                && before
                    .as_ref()
                    .is_none_or(|old| old["unit"] != counters["unit"])
            {
                self.event(ordinal, format!("{name} spawned"))?;
            }
            self.previous.insert(id, counters);
        }
        if let Some(objects) = objects {
            self.max_objects = self.max_objects.max(objects.records().len());
            self.object_types
                .extend(objects.records().iter().map(|record| record.object_type()));
        } else {
            let objects = tick["objects"].as_array().ok_or("missing objects")?;
            self.max_objects = self.max_objects.max(objects.len());
            for object in objects {
                self.object_types.insert(
                    object["object_type"]
                        .as_u64()
                        .ok_or("invalid object type")?,
                );
            }
        }
        if !postgame && let Some(meta) = tick["game_meta"].as_object() {
            recycle::map(&mut self.final_meta, meta);
        }
        if ends_now && !postgame {
            self.event(ordinal, "Game ended".into())?;
            self.match_end_source_tick = Some(ordinal);
        }
        Ok(())
    }
    fn metadata(
        &self,
        request: &Request,
        stride: usize,
    ) -> Result<Map<String, Value>, Box<dyn Error>> {
        self.metadata_for_source_ticks(request, stride, request.ticks)
    }

    fn metadata_for_source_ticks(
        &self,
        request: &Request,
        stride: usize,
        source_ticks: usize,
    ) -> Result<Map<String, Value>, Box<dyn Error>> {
        let count = sampling::sample_count(source_ticks, stride);
        let mut meta = self.final_meta.clone();
        meta.insert("map_name".into(), json!(request.map));
        if let Some(players) = meta.get_mut("players").and_then(Value::as_object_mut) {
            for (id, player) in players {
                let series = id.parse::<u64>().ok().and_then(|id| self.series.get(&id));
                for (_, metric) in sampling::METRICS {
                    player[metric] = series
                        .and_then(|s| s.get(metric))
                        .map_or(json!({}), |s| json!(s));
                }
            }
        }
        let events: Vec<_> = self
            .events
            .iter()
            .map(|event| format!("{}: {}", event.source_tick, event.description))
            .collect();
        let mut replay =
            json!({"summary":{"ticks_recorded":count, "ticks_elapsed":count, "ticks_dropped":0,
            "recording_duration":request.ticks as f64/120.0, "is_full_game":self.match_end_source_tick.is_some()},
            "game_meta":meta, "events":events})
            .as_object()
            .unwrap()
            .clone();
        sampling::retime_metadata(&mut replay, stride, count)?;
        Ok(replay)
    }
}

fn encode(request_path: &Path, directory: &Path) -> Result<(), Box<dyn Error>> {
    let started = Instant::now();
    let request: Request = serde_json::from_reader(BufReader::new(File::open(request_path)?))?;
    request.validate()?;
    artifact::select_revision(request.viewer_profile_revision)?;
    fs::create_dir(directory)?;
    let mut high = artifact::PrimaryExport::new(
        &directory.join("parts-120"),
        request.ticks,
        request.zstd_level,
    )?;
    let mut low = (!request.source_viewer_only)
        .then(|| {
            artifact::StreamingExport::new(
                &directory.join("parts-30"),
                sampling::sample_count(request.ticks, 4),
                request.zstd_level,
            )
        })
        .transpose()?;
    let input = io::stdin();
    let mut source = transport::Stream::with_contract(
        BufReader::with_capacity(64 * 1024, input.lock()),
        &request.transport_contract,
    )?;
    let mut observations = Observations {
        legacy_analytics: request.analytics_revision == 1,
        ..Default::default()
    };
    let mut native = (request.analytics_revision >= 3).then(native::NativeAnalytics::default);
    let mut combat = (request.analytics_revision == 4)
        .then(|| combat::Combat::new(request.combat_network_recording));
    let mut count = 0;
    let mut analytics = request
        .analytics_context
        .as_ref()
        .map(|_| {
            analytics::Export::with_revision(
                &directory.join("analytics.30hz.json.zst"),
                request.analytics_revision,
            )
        })
        .transpose()?;
    let mut spare = Value::Null;
    let incremental = request.incremental_state
        && request.transport_contract == "HSFT0002"
        && high.supports_incremental();
    let typed_poses = incremental && request.typed_poses && high.supports_typed_poses();
    if request.verify_incremental_state && !incremental {
        return Err("full-source verification requires incremental state".into());
    }
    #[cfg(all(feature = "native-cached-spawns", not(windows)))]
    { source.cache_spawns = incremental && high.supports_cached_spawns(); }
    while let Some(mut tick) = if incremental {
        source.next_incremental_with_poses(spare, typed_poses)?
    } else {
        source.next_reusing(spare)?
    } {
        if count >= request.ticks {
            return Err("engine exported more ticks than the film".into());
        }
        if request.verify_incremental_state {
            source.verify_incremental_source(&tick)?;
        }
        if let Some(native) = &mut native {
            native.observe(&tick, count)?;
        }
        if let Some(combat) = &mut combat {
            combat.observe(&tick, count)?;
        }
        tick.as_object_mut().unwrap().remove("combat");
        observations.observe_state(
            &mut tick,
            count,
            request.players,
            incremental.then_some(&source.objects),
        )?;
        sampling::normalize(&mut tick, count, 1, &request.map)?;
        if let Some(analytics) = &mut analytics {
            if count == 0 && let Some(spawns) = &source.objects.spawns {
                tick["spawns"] = spawns.source().clone();
            }
            analytics.observe(&tick, count)?;
            if source.objects.spawns.is_some() {
                tick["spawns"] = Value::Array(Vec::new());
            }
        }
        let sample = if low.is_some() && count.is_multiple_of(4) {
            let mut sample = tick.clone();
            if incremental {
                sample["objects"] = source.objects.materialize();
                if let Some(spawns) = &source.objects.spawns {
                    sample["spawns"] = spawns.source().clone();
                }
                source.poses.materialize(&mut sample)?;
            }
            Some(sample)
        } else {
            None
        };
        if incremental {
            high.push_incremental_source(
                &mut tick,
                &source.objects,
                typed_poses.then_some(&source.poses),
            )?;
        } else {
            high.push_transport_source(&mut tick)?;
        }
        spare = tick;
        if let Some(mut sample) = sample {
            sampling::normalize(&mut sample, count, 4, &request.map)?;
            low.as_mut().unwrap().push_owned(sample)?;
        }
        count += 1;
    }
    if count != request.ticks {
        return Err(format!(
            "engine exported {count} ticks; film requires {}",
            request.ticks
        )
        .into());
    }
    let high = high.finish(
        &observations.metadata(&request, 1)?,
        &directory.join("replay.120hz.hsrdc"),
        &format!("{}-120hz", request.replay_id),
        &request.recorded_at,
    )?;
    let low = low
        .map(|writer| {
            writer.finish(
                &observations.metadata(&request, 4)?,
                &directory.join("replay.30hz.hsrdc"),
                &format!("{}-30hz", request.replay_id),
                &request.recorded_at,
            )
        })
        .transpose()?;
    let analytics = analytics
        .map(|writer| {
            writer.finish(
                &observations.metadata_for_source_ticks(
                    &request,
                    4,
                    if request.analytics_revision == 1 {
                        count
                    } else {
                        observations
                            .match_end_source_tick
                            .map_or(count, |end| end + 1)
                    },
                )?,
                request.analytics_context.as_ref().unwrap(),
                count,
            )
        })
        .transpose()?;
    let mut native_product = native.map(|native| native.product());
    if let Some(combat) = combat {
        let product = native_product.as_mut().unwrap();
        product["schema"] = json!("halospawns.h1NativeAnalytics.v2");
        product["combat"] = combat.product()?;
    }
    let report = json!({"schema":"halospawns.h1FilmEncoding.v1", "source_ticks":count,
        "verification":{"mode":if (4..=5).contains(&request.viewer_profile_revision) { "inline-bounded-poses" } else { "inline-lossless" }, "120hz":count,
            "30hz":low.as_ref().map(|_| sampling::sample_count(count, 4))},
        "export_contract":request.export_contract, "transport_contract":request.transport_contract,
        "analytics":analytics, "analytics_revision":request.analytics_revision,
        "viewer_profile_revision":request.viewer_profile_revision,
        "native_analytics":native_product,
        "state_reuse":{"enabled":incremental,"objects_decoded":source.objects.decoded,"objects_reused":source.objects.reused,
            "typed_poses":typed_poses,"poses_decoded":source.poses.decoded,"pose_nodes_decoded":source.poses.nodes_decoded,
            "verified_source_ticks":if request.verify_incremental_state {count} else {0}},
        "source_first_clock":observations.first_clock, "source_last_clock":observations.last_clock,
        "source_hz":120, "sampling":{"120hz":{"stride":1,"phase":0}, "30hz":{"stride":4,"phase":0}},
        "field_units":{"respawn_timer":"output-rate ticks, positive remainder rounded up", "reload_time":"output-rate ticks, positive remainder rounded up",
            "airborne_ticks":"output-rate ticks, source saturates at 127; rounded up", "velocity":"world units per output tick",
            "melee_animation_remaining":"30 Hz animation frames", "first_person_weapon.animation_tick":"30 Hz authored animation frames",
            "events_and_chart_keys":"output sample indices; unsampled deltas mapped to the next sample, clamped at the tail",
            "score":"native mode-specific units; King uses 30 Hz ticks"},
        "duration_seconds":count as f64/120.0, "transport_bytes":source.bytes,
        "players":observations.players, "object_types":observations.object_types,
        "max_objects":observations.max_objects, "max_player_shots":observations.max_shots,
        "max_player_deaths":observations.max_deaths, "counter_events":observations.events.len(),
        "source_events":observations.events, "chart_points":observations.metric_points,
        "kill_ticks":observations.series.iter().map(|(slot, metrics)| (slot.to_string(), json!(
            metrics.get("kills_by_tick").into_iter().flatten().map(|(tick, positions)|
                (tick.to_string(), json!(positions.as_array().map_or(0, Vec::len))))
                .collect::<Map<String, Value>>()))).collect::<Map<String, Value>>(),
        "body_handle_replacements":observations.body_replacements,
        "game_type":observations.final_meta.get("game_type"), "has_teams":observations.final_meta.get("has_teams"),
        "initial_counters":observations.initial_counters,
        "final_counters":observations.previous, "zstd_level":request.zstd_level,
        "wall_seconds":started.elapsed().as_secs_f64(), "120hz":high,"30hz":low});
    fs::write(
        directory.join("encoding.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("Encoded and verified {count} source ticks");
    Ok(())
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("validate") if args.len() == 2 => {
            println!("{}", serde_json::to_string(&artifact::validate_file(Path::new(&args[1]))?)?);
            Ok(())
        }
        Some("encode") if args.len() == 3 => encode(Path::new(&args[1]), Path::new(&args[2])),
        Some("verify") if args.len() == 3 => {
            let report = artifact::verify_pair(Path::new(&args[1]), Path::new(&args[2]))?;
            println!("{}", serde_json::to_string_pretty(&report)?);
            Ok(())
        }
        Some("inspect-ticks") if matches!(args.len(), 3 | 4) => {
            let reader = BufReader::new(File::open(&args[1])?);
            let mut input = match args.get(3) {
                Some(contract) => transport::Stream::with_contract(reader, contract),
                None => transport::Stream::new(reader),
            }?;
            let mut output = BufWriter::new(File::options().write(true).create_new(true).open(&args[2])?);
            while let Some(tick) = input.next()? { serde_json::to_writer(&mut output, &tick)?; output.write_all(b"\n")?; }
            output.flush()?;
            Ok(())
        }
        _ => Err("usage: h1-film-encoder encode <request.json> <new-output-dir> (binary stdin)\n       h1-film-encoder verify <120hz.hsrdc> <30hz.hsrdc>\n       h1-film-encoder inspect-ticks <capture.hsft> <new-output.ndjson> [HSFT0001|HSFT0002]".into()),
    }
}
fn main() {
    if let Err(error) = run() {
        eprintln!("h1-film-encoder: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod observation_tests {
    use super::*;
    #[test]
    fn legacy_requests_keep_the_original_adapter_and_unknown_contracts_fail() {
        let value = json!({"ticks":1,"players":1,"map":"dread",
            "replay_id":"legacy","recorded_at":"2026-10-03T00:00:00Z"});
        let legacy: Request = serde_json::from_value(value.clone()).unwrap();
        legacy.validate().unwrap();
        assert_eq!(legacy.transport_contract, "HSFT0001");
        let mut packed = value.clone();
        packed["transport_contract"] = json!("HSFT0002");
        let packed: Request = serde_json::from_value(packed).unwrap();
        packed.validate().unwrap();
        assert_eq!(packed.export_contract, "HSFT0001");
        for (key, wrong) in [
            ("source_tick_rate", json!(60)),
            ("export_contract", json!("HSFT0002")),
            ("transport_contract", json!("HSFT0003")),
        ] {
            let mut unsupported = value.clone();
            unsupported[key] = wrong;
            let unsupported: Request = serde_json::from_value(unsupported).unwrap();
            assert!(unsupported.validate().is_err());
        }
    }
    #[test]
    fn timed_scores_do_not_expand_events_but_deaths_still_do() {
        for mode in [3, 4] {
            let mut observations = Observations::default();
            for index in 0..100 {
                let mut tick = json!({"current_tick":index,"game_type":mode,
                    "players":[{"player_index":0,"score":index,"deaths":if index >= 50 { 1 } else { 0 }}],
                    "objects":[]});
                observations.observe(&mut tick, index, 1).unwrap();
            }
            assert_eq!(observations.events.len(), 2);
            assert_eq!(observations.previous[&0]["score"], 99);
            assert_eq!(observations.events[1].source_tick, 50);
            assert_eq!(observations.events[1].description, "Player 0 died (1)");
            assert_eq!(
                observations.series[&0]["deaths_by_tick"][&50],
                json!([[null, null, null]])
            );
        }
    }

    #[test]
    fn counter_event_budget_fails_instead_of_dropping_events() {
        let mut observations = Observations {
            event_bytes: 8 * 1024 * 1024,
            ..Default::default()
        };
        let mut tick =
            json!({"current_tick":0,"players":[{"player_index":0,"deaths":0}],"objects":[]});
        let error = observations.observe(&mut tick, 0, 1).unwrap_err();
        assert!(error.to_string().contains("metadata budget"));
    }

    #[test]
    fn unsampled_counter_changes_and_respawns_are_retained() {
        let mut observations = Observations::default();
        for index in 0..5 {
            let mut tick = json!({"current_tick":index,"players":[{"player_index":0,
                "player_object_id":if index == 1 { -1 } else if index > 1 { -65534 } else { -65535 },
                "deaths":if index > 0 { 1 } else { 0 },"shots_fired":0}],"objects":[],
                "game_meta":{"map_name":"downrush"}});
            observations.observe(&mut tick, index, 1).unwrap();
        }
        assert_eq!(observations.body_replacements, 1);
        assert_eq!(observations.events[1].source_tick, 1);
        assert_eq!(observations.events[1].description, "Player 0 died (1)");
    }

    #[test]
    fn viewer_events_and_all_six_charts_use_output_ticks_without_losing_subsample_changes() {
        let mut observations = Observations::default();
        let mut source = Vec::new();
        for index in 0..5 {
            let value = index.min(2);
            let mut tick = json!({"current_tick":index,"game_time_info":{"game_time":index},"players":[{"player_index":0,"name":"A",
                "kills":value,"deaths":value,"assists":value,"shots_fired":value}],"objects":[],
                "game_meta":{"players":{"0":{"name":"A","damage_dealt":value * 10,
                    "damage_received":value * 5}}}});
            observations.observe(&mut tick, index, 1).unwrap();
            source.push(tick);
        }
        let request = Request {
            viewer_profile_revision: 2,
            source_viewer_only: false,
            incremental_state: true,
            typed_poses: true,
            verify_incremental_state: false,
            analytics_revision: 2,
            combat_network_recording: false,
            ticks: 5,
            players: 1,
            map: "downrush".into(),
            replay_id: "test".into(),
            recorded_at: "2026-10-03T00:00:00Z".into(),
            analytics_context: None,
            zstd_level: 6,
            source_tick_rate: 120,
            export_contract: default_export_contract(),
            transport_contract: default_export_contract(),
        };
        let low = observations.metadata(&request, 4).unwrap();
        for (counter, metric) in sampling::METRICS {
            let expected = match counter {
                "damage_dealt" => 20.0,
                "damage_received" => 10.0,
                _ => 2.0,
            };
            let expected = if matches!(counter, "kills" | "deaths") {
                json!({"1":[[null,null,null],[null,null,null]]})
            } else {
                json!({"1":expected})
            };
            assert_eq!(low["game_meta"]["players"]["0"][metric], expected);
        }
        assert!(
            low["events"]
                .as_array()
                .unwrap()
                .contains(&json!("1: A died (2)"))
        );
        assert!(
            low["events"]
                .as_array()
                .unwrap()
                .contains(&json!("1: A got a kill (1)"))
        );
        assert!(
            low["events"]
                .as_array()
                .unwrap()
                .iter()
                .all(|event| !event.as_str().unwrap().contains('{'))
        );
        let mut high = observations.metadata(&request, 1).unwrap();
        sampling::retime_metadata(&mut high, 4, 2).unwrap();
        assert_eq!(high["game_meta"], low["game_meta"]);
        assert_eq!(high["events"], low["events"]);

        let directory = std::env::temp_dir().join(format!(
            "h1-film-observed-metadata-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        for (stride, rate) in [(1, 120), (4, 30)] {
            let count = sampling::sample_count(source.len(), stride);
            let mut writer =
                artifact::StreamingExport::new(&directory.join(format!("parts-{rate}")), count, 1)
                    .unwrap();
            for (index, tick) in source.iter().enumerate().step_by(stride) {
                let mut tick = tick.clone();
                sampling::normalize(&mut tick, index, stride, &request.map).unwrap();
                writer.push(&tick).unwrap();
            }
            writer
                .finish(
                    &observations.metadata(&request, stride).unwrap(),
                    &directory.join(format!("replay.{rate}hz.hsrdc")),
                    &format!("test-{rate}hz"),
                    &request.recorded_at,
                )
                .unwrap();
        }
        artifact::verify_pair(
            &directory.join("replay.120hz.hsrdc"),
            &directory.join("replay.30hz.hsrdc"),
        )
        .unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn a_partial_recording_does_not_reemit_prior_kills_as_new_events() {
        let mut observations = Observations::default();
        observations
            .observe(
                &mut json!({"current_tick":0,"players":[{"player_index":0,
            "kills":5,"deaths":3,"assists":2}],"objects":[]}),
                0,
                1,
            )
            .unwrap();
        assert_eq!(observations.events.len(), 1);
        assert!(observations.series.is_empty());
        assert_eq!(observations.initial_counters[&0]["kills"], 5);
    }

    fn match_tick(i: usize, end: Option<usize>) -> Value {
        json!({"current_tick":i,"game_time_info":{"game_time":i},
            "game_type":2,"game_engine_has_teams":false,"game_ended_this_tick":end==Some(i),
            "players":[{"player_index":0,"name":"A","kills":i,"deaths":i,"assists":i,
                "suicides":i,"team_kills":i,"score":i,"ctf_score":i,
                "shots_fired":i,"shots_hit":i,"object_ref":1,"player_object_id":1,
                "player_object_data":{"x":i,"y":1,"z":2,"primary_nades":20-i}}],
            "objects":[{"object_type":2,"object_id":1,"x":i,"y":1,"z":2}],
            "game_meta":{"game_type":2,"has_teams":false,"players":{"0":{"name":"A",
                "damage_dealt":i*10,"damage_received":i*5,"camo_count":i,"overshield_count":i}}}})
    }

    #[test]
    fn match_end_freezes_statistics_and_events_but_not_replay_movement() {
        for end in [0, 1, 3, 4, 5, 8] {
            let mut observations = Observations::default();
            for i in 0..12 {
                let mut tick = match_tick(i, Some(end));
                observations.observe(&mut tick, i, 1).unwrap();
                assert_eq!(tick["players"][0]["kills"], i.min(end));
                assert_eq!(tick["players"][0]["score"], i.min(end));
                assert_eq!(tick["players"][0]["ctf_score"], i.min(end));
                assert_eq!(tick["players"][0]["player_object_data"]["x"], i);
                assert_eq!(tick["objects"][0]["x"], i);
                if end > 0 {
                    assert_eq!(tick["players"][0]["shots_fired"], i.min(end - 1));
                    assert_eq!(tick["players"][0]["shots_hit"], i.min(end - 1));
                    assert_eq!(
                        tick["game_meta"]["players"]["0"]["damage_dealt"],
                        i.min(end - 1) * 10
                    );
                    assert_eq!(
                        tick["game_meta"]["players"]["0"]["camo_count"],
                        i.min(end - 1)
                    );
                } else {
                    assert!(tick["players"][0].get("shots_fired").is_none());
                    assert!(
                        tick["game_meta"]["players"]["0"]
                            .get("damage_dealt")
                            .is_none()
                    );
                }
            }
            assert_eq!(observations.last_clock, Some(11));
            assert_eq!(observations.match_end_source_tick, Some(end));
            assert!(
                observations
                    .events
                    .iter()
                    .all(|event| event.source_tick <= end)
            );
            assert_eq!(
                observations
                    .events
                    .iter()
                    .filter(|event| event.description == "Game ended")
                    .count(),
                1
            );
            assert!(
                observations
                    .events
                    .iter()
                    .filter(|event| event.source_tick == end)
                    .all(|event| !event.description.contains("picked up")
                        && !event.description.contains("threw a")
                        && !event.description.contains("spawned"))
            );
            for (metric, series) in observations.series.get(&0).into_iter().flatten() {
                let limit = if matches!(
                    *metric,
                    "kills_by_tick" | "deaths_by_tick" | "assists_by_tick"
                ) {
                    end
                } else {
                    end.saturating_sub(1)
                };
                assert!(series.keys().all(|tick| *tick <= limit));
            }
        }
    }

    #[test]
    fn postgame_still_validates_clock_and_roster() {
        let mut observations = Observations::default();
        observations
            .observe(&mut match_tick(0, Some(0)), 0, 1)
            .unwrap();
        assert!(
            observations
                .observe(&mut match_tick(2, None), 1, 1)
                .is_err()
        );
        let mut bad = match_tick(1, None);
        let duplicate = bad["players"][0].clone();
        bad["players"].as_array_mut().unwrap().push(duplicate);
        assert!(observations.observe(&mut bad, 1, 1).is_err());
    }

    #[test]
    fn explicitly_pinned_revision_one_retains_postgame_statistics() {
        let mut observations = Observations {
            legacy_analytics: true,
            ..Default::default()
        };
        for i in 0..12 {
            let mut tick = match_tick(i, Some(3));
            observations.observe(&mut tick, i, 1).unwrap();
            assert_eq!(tick["players"][0]["shots_fired"], i);
        }
        assert_eq!(observations.match_end_source_tick, Some(3));
        assert_eq!(observations.previous[&0]["damage_dealt"], 110);
        assert!(
            observations
                .events
                .iter()
                .any(|event| event.source_tick > 3)
        );
    }

    #[test]
    fn analytics_stops_at_match_end_while_both_viewer_rates_keep_the_tail() {
        for end in [None, Some(0), Some(1), Some(3), Some(4), Some(5), Some(8)] {
            let directory = std::env::temp_dir()
                .join(format!("h1-match-window-{}-{end:?}", std::process::id()));
            fs::create_dir(&directory).unwrap();
            let path = directory.join("analytics.zst");
            let mut analytics = analytics::Export::new(&path).unwrap();
            let mut observations = Observations::default();
            let request = Request {
                viewer_profile_revision: 2,
                source_viewer_only: false,
                incremental_state: true,
                typed_poses: true,
                verify_incremental_state: false,
                analytics_revision: 2,
                combat_network_recording: false,
                ticks: 12,
                players: 1,
                map: "prisoner".into(),
                replay_id: "boundary".into(),
                recorded_at: "1970-01-01T00:00:00Z".into(),
                analytics_context: None,
                zstd_level: 1,
                source_tick_rate: 120,
                export_contract: default_export_contract(),
                transport_contract: default_export_contract(),
            };
            let mut high =
                artifact::StreamingExport::new(&directory.join("parts-120"), 12, 1).unwrap();
            let mut low =
                artifact::StreamingExport::new(&directory.join("parts-30"), 3, 1).unwrap();
            for i in 0..12 {
                let mut tick = match_tick(i, end);
                observations.observe(&mut tick, i, 1).unwrap();
                sampling::normalize(&mut tick, i, 1, &request.map).unwrap();
                analytics.observe(&tick, i).unwrap();
                high.push(&tick).unwrap();
                if i.is_multiple_of(4) {
                    sampling::normalize(&mut tick, i, 4, &request.map).unwrap();
                    low.push(&tick).unwrap();
                }
            }
            let ticks = end.map_or(12, |end| end + 1);
            let metadata = observations
                .metadata_for_source_ticks(&request, 4, ticks)
                .unwrap();
            let result = analytics
                .finish(&metadata, &json!({"gametype":"Slayer"}), 12)
                .unwrap();
            assert_eq!(result["ticks"], ticks.div_ceil(4));
            assert_eq!(result["statistics_source_ticks"], ticks);
            let parsed: Value =
                serde_json::from_slice(&zstd::decode_all(File::open(&path).unwrap()).unwrap())
                    .unwrap();
            assert_eq!(parsed["ticks"].as_array().unwrap().len(), ticks.div_ceil(4));
            assert_eq!(
                parsed["ticks"].as_array().unwrap().last().unwrap()["players"][0]["score"],
                end.unwrap_or(11)
            );
            if let Some(end) = end.filter(|tick| tick.is_multiple_of(4)) {
                assert!(parsed["ticks"][end / 4]["players"][0]["player_object_data"].is_null());
            }
            let high_report = high
                .finish(
                    &observations.metadata(&request, 1).unwrap(),
                    &directory.join("high.hsrdc"),
                    "boundary-120hz",
                    &request.recorded_at,
                )
                .unwrap();
            let low_report = low
                .finish(
                    &observations.metadata(&request, 4).unwrap(),
                    &directory.join("low.hsrdc"),
                    "boundary-30hz",
                    &request.recorded_at,
                )
                .unwrap();
            assert_eq!(serde_json::to_value(high_report).unwrap()["tickCount"], 12);
            assert_eq!(serde_json::to_value(low_report).unwrap()["tickCount"], 3);
            artifact::verify_pair(&directory.join("high.hsrdc"), &directory.join("low.hsrdc"))
                .unwrap();
            fs::remove_dir_all(directory).unwrap();
        }
    }
}
