mod analytics;
mod artifact;
mod sampling;
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

impl Request {
    fn validate(&self) -> Result<(), Box<dyn Error>> {
        if !(1..=432_000).contains(&self.ticks) || !(1..=4).contains(&self.players) {
            return Err("invalid request tick or player count".into());
        }
        // Keep the original adapter's timer/score semantics. A future source ABI
        // or rate needs an explicit encoder adapter, not silent reinterpretation.
        if self.source_tick_rate != 120 || self.export_contract != "HSFT0001" {
            return Err("unsupported engine rate or export contract".into());
        }
        Ok(())
    }
}

#[derive(Default)]
struct Observations {
    first_clock: Option<u64>,
    last_clock: Option<u64>,
    players: BTreeSet<u64>,
    object_types: BTreeSet<u64>,
    max_objects: usize,
    max_shots: u64,
    max_deaths: u64,
    previous: BTreeMap<u64, Value>,
    initial_counters: BTreeMap<u64, Value>,
    last_body: BTreeMap<u64, i64>,
    body_replacements: usize,
    events: Vec<ObservedEvent>,
    event_bytes: usize,
    series: BTreeMap<u64, BTreeMap<&'static str, BTreeMap<usize, Value>>>,
    metric_points: usize,
    final_meta: Map<String, Value>,
    ended: bool,
}

#[derive(serde::Serialize)]
struct ObservedEvent {
    source_tick: usize,
    time_seconds: f64,
    description: String,
}

impl Observations {
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

    fn observe(
        &mut self,
        tick: &Value,
        ordinal: usize,
        seats: usize,
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
        let players = tick["players"].as_array().ok_or("missing players")?;
        if players.len() > 4 || (ordinal == 0 && players.len() != seats) {
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
            // Observe counters at 120 Hz before decimation; do not guess killer/victim pairs.
            let mut counters = Map::new();
            for key in [
                "kills",
                "deaths",
                "assists",
                "suicides",
                "team_kills",
                "shots_fired",
                "shots_hit",
                "score",
            ] {
                if let Some(value) = player.get(key) {
                    counters.insert(key.into(), value.clone());
                }
            }
            for key in [
                "damage_dealt",
                "damage_received",
                "camo_count",
                "overshield_count",
            ] {
                if let Some(value) = tick["game_meta"]["players"][id.to_string()].get(key) {
                    counters.insert(key.into(), value.clone());
                }
            }
            counters.insert("unit".into(), player["object_ref"].clone());
            for key in ["primary_nades", "secondary_nades"] {
                counters.insert(key.into(), player["player_object_data"][key].clone());
            }
            let counters = Value::Object(counters);
            if ordinal == 0 {
                self.initial_counters.insert(id, counters.clone());
            }
            let before = self.previous.get(&id).cloned();
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
                if counters["unit"].as_u64().is_some() && before["unit"] == counters["unit"] {
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
            if counters["unit"].as_u64().is_some()
                && before
                    .as_ref()
                    .is_none_or(|old| old["unit"] != counters["unit"])
            {
                self.event(ordinal, format!("{name} spawned"))?;
            }
            self.previous.insert(id, counters);
        }
        let objects = tick["objects"].as_array().ok_or("missing objects")?;
        self.max_objects = self.max_objects.max(objects.len());
        for object in objects {
            self.object_types.insert(
                object["object_type"]
                    .as_u64()
                    .ok_or("invalid object type")?,
            );
        }
        if let Some(meta) = tick["game_meta"].as_object() {
            self.final_meta = meta.clone();
        }
        if tick["game_ended_this_tick"].as_bool().unwrap_or(false) {
            if !self.ended {
                self.event(ordinal, "Game ended".into())?;
            }
            self.ended = true;
        }
        Ok(())
    }
    fn metadata(
        &self,
        request: &Request,
        stride: usize,
    ) -> Result<Map<String, Value>, Box<dyn Error>> {
        let count = sampling::sample_count(request.ticks, stride);
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
            "recording_duration":request.ticks as f64/120.0, "is_full_game":self.ended},
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
    fs::create_dir(directory)?;
    let mut high = artifact::PrimaryExport::new(
        &directory.join("parts-120"),
        request.ticks,
        request.zstd_level,
    )?;
    let mut low = artifact::StreamingExport::new(
        &directory.join("parts-30"),
        sampling::sample_count(request.ticks, 4),
        request.zstd_level,
    )?;
    let input = io::stdin();
    let mut source = transport::Stream::new(BufReader::with_capacity(64 * 1024, input.lock()))?;
    let mut observations = Observations::default();
    let mut count = 0;
    let mut analytics = request
        .analytics_context
        .as_ref()
        .map(|_| analytics::Export::new(&directory.join("analytics.30hz.json.zst")))
        .transpose()?;
    while let Some(mut tick) = source.next()? {
        if count >= request.ticks {
            return Err("engine exported more ticks than the film".into());
        }
        observations.observe(&tick, count, request.players)?;
        sampling::normalize(&mut tick, count, 1, &request.map)?;
        if let Some(analytics) = &mut analytics {
            analytics.observe(&tick, count)?;
        }
        let sample = count.is_multiple_of(4).then(|| tick.clone());
        high.push_owned(tick)?;
        if let Some(mut sample) = sample {
            sampling::normalize(&mut sample, count, 4, &request.map)?;
            low.push_owned(sample)?;
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
    let low = low.finish(
        &observations.metadata(&request, 4)?,
        &directory.join("replay.30hz.hsrdc"),
        &format!("{}-30hz", request.replay_id),
        &request.recorded_at,
    )?;
    let analytics = analytics
        .map(|writer| {
            writer.finish(
                &observations.metadata(&request, 4)?,
                request.analytics_context.as_ref().unwrap(),
                count,
            )
        })
        .transpose()?;
    let report = json!({"schema":"halospawns.h1FilmEncoding.v1", "source_ticks":count,
        "export_contract":request.export_contract,
        "analytics":analytics,
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
        "body_handle_replacements":observations.body_replacements,
        "game_type":observations.final_meta.get("game_type"), "has_teams":observations.final_meta.get("has_teams"),
        "initial_counters":observations.initial_counters,
        "final_counters":observations.previous, "zstd_level":request.zstd_level,
        "wall_seconds":started.elapsed().as_secs_f64(), "120hz":high,"30hz":low});
    fs::write(
        directory.join("encoding.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("Encoded {count} source ticks into 120 Hz and 30 Hz artifacts");
    Ok(())
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("encode") if args.len() == 3 => encode(Path::new(&args[1]), Path::new(&args[2])),
        Some("verify") if args.len() == 3 => {
            let report = artifact::verify_pair(Path::new(&args[1]), Path::new(&args[2]))?;
            println!("{}", serde_json::to_string_pretty(&report)?);
            Ok(())
        }
        Some("inspect-ticks") if args.len() == 3 => {
            let mut input = transport::Stream::new(BufReader::new(File::open(&args[1])?))?;
            let mut output = BufWriter::new(File::options().write(true).create_new(true).open(&args[2])?);
            while let Some(tick) = input.next()? { serde_json::to_writer(&mut output, &tick)?; output.write_all(b"\n")?; }
            output.flush()?;
            Ok(())
        }
        _ => Err("usage: h1-film-encoder encode <request.json> <new-output-dir> (binary stdin)\n       h1-film-encoder verify <120hz.hsrdc> <30hz.hsrdc>\n       h1-film-encoder inspect-ticks <capture.hsft> <new-output.ndjson>".into()),
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
        for (key, wrong) in [
            ("source_tick_rate", json!(60)),
            ("export_contract", json!("HSFT0002")),
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
                let tick = json!({"current_tick":index,"game_type":mode,
                    "players":[{"player_index":0,"score":index,"deaths":if index >= 50 { 1 } else { 0 }}],
                    "objects":[]});
                observations.observe(&tick, index, 1).unwrap();
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
        let tick = json!({"current_tick":0,"players":[{"player_index":0,"deaths":0}],"objects":[]});
        let error = observations.observe(&tick, 0, 1).unwrap_err();
        assert!(error.to_string().contains("metadata budget"));
    }

    #[test]
    fn unsampled_counter_changes_and_respawns_are_retained() {
        let mut observations = Observations::default();
        for index in 0..5 {
            let tick = json!({"current_tick":index,"players":[{"player_index":0,
                "player_object_id":if index == 1 { -1 } else if index > 1 { -65534 } else { -65535 },
                "deaths":if index > 0 { 1 } else { 0 },"shots_fired":0}],"objects":[],
                "game_meta":{"map_name":"downrush"}});
            observations.observe(&tick, index, 1).unwrap();
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
            let tick = json!({"current_tick":index,"game_time_info":{"game_time":index},"players":[{"player_index":0,"name":"A",
                "kills":value,"deaths":value,"assists":value,"shots_fired":value}],"objects":[],
                "game_meta":{"players":{"0":{"name":"A","damage_dealt":value * 10,
                    "damage_received":value * 5}}}});
            observations.observe(&tick, index, 1).unwrap();
            source.push(tick);
        }
        let request = Request {
            ticks: 5,
            players: 1,
            map: "downrush".into(),
            replay_id: "test".into(),
            recorded_at: "2026-10-03T00:00:00Z".into(),
            analytics_context: None,
            zstd_level: 6,
            source_tick_rate: 120,
            export_contract: default_export_contract(),
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
                &json!({"current_tick":0,"players":[{"player_index":0,
            "kills":5,"deaths":3,"assists":2}],"objects":[]}),
                0,
                1,
            )
            .unwrap();
        assert_eq!(observations.events.len(), 1);
        assert!(observations.series.is_empty());
        assert_eq!(observations.initial_counters[&0]["kills"], 5);
    }
}
