use serde_json::{Map, Value, json};
use std::error::Error;
use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::Path;

const MAX_RAW_BYTES: u64 = 256 * 1024 * 1024;
const PLAYER_FIELDS: &[&str] = &[
    "player_index",
    "name",
    "team",
    "kills",
    "deaths",
    "assists",
    "suicides",
    "team_kills",
    "score",
    "ctf_score",
    "player_quit",
];

struct Bounded<W> {
    inner: W,
    bytes: u64,
}

impl<W: Write> Write for Bounded<W> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if self.bytes + buffer.len() as u64 > MAX_RAW_BYTES {
            return Err(io::Error::other("H1 analytics source exceeds 256 MiB"));
        }
        let count = self.inner.write(buffer)?;
        self.bytes += count as u64;
        Ok(count)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

// Private, non-playable input to the existing Xbox analytics extractor. Positions
// are sampled at 30 Hz; metadata counters are observed at 120 Hz before retiming.
pub struct Export {
    revision: u8,
    output: Bounded<BufWriter<zstd::stream::write::Encoder<'static, BufWriter<File>>>>,
    pending: Option<Value>,
    final_players: Vec<Value>,
    samples: usize,
    first_ended_tick: Option<usize>,
    game_type: Option<u64>,
    has_teams: Option<bool>,
}

fn selected_player(player: &Value) -> Value {
    let mut fields = Map::new();
    for key in PLAYER_FIELDS {
        if let Some(value) = player.get(key) {
            fields.insert((*key).into(), value.clone());
        }
    }
    // Playback makes every seat local. That is not evidence of the recording's
    // host/controller topology, so do not export local_player as ingest evidence.
    Value::Object(fields)
}

fn select_player_reusing(player: &Value, target: &mut Value) {
    if let Some(fields) = target.as_object_mut()
        && fields.keys().map(String::as_str).eq(
            PLAYER_FIELDS.iter().copied().filter(|key| player.get(*key).is_some()),
        )
    {
        for (key, value) in fields {
            crate::recycle::value(value, &player[key]);
        }
    } else {
        *target = selected_player(player);
    }
}

impl Export {
    #[cfg(test)]
    pub fn new(path: &Path) -> Result<Self, Box<dyn Error>> {
        Self::with_revision(path, 2)
    }

    pub fn with_revision(path: &Path, revision: u8) -> Result<Self, Box<dyn Error>> {
        let file = File::options().write(true).create_new(true).open(path)?;
        let mut output = Bounded {
            inner: BufWriter::with_capacity(
                64 * 1024,
                zstd::stream::write::Encoder::new(BufWriter::new(file), 3)?,
            ),
            bytes: 0,
        };
        output.write_all(b"{\"ticks\":[")?;
        Ok(Self {
            revision,
            output,
            pending: None,
            final_players: Vec::new(),
            samples: 0,
            first_ended_tick: None,
            game_type: None,
            has_teams: None,
        })
    }

    pub fn observe(&mut self, tick: &Value, ordinal: usize) -> Result<(), Box<dyn Error>> {
        if self.revision >= 2 && self.first_ended_tick.is_some() {
            return Ok(());
        }
        let players = tick["players"]
            .as_array()
            .ok_or("missing analytics players")?;
        if self.revision >= 4 {
            for player in players {
                if let Some(target) = self.final_players.iter_mut()
                    .find(|previous| previous["player_index"] == player["player_index"])
                {
                    select_player_reusing(player, target);
                } else {
                    self.final_players.push(selected_player(player));
                }
            }
        } else {
            self.final_players.resize_with(players.len(), || Value::Null);
            for (player, target) in players.iter().zip(&mut self.final_players) {
                select_player_reusing(player, target);
            }
        }
        self.game_type = tick["game_type"].as_u64();
        self.has_teams = tick["game_engine_has_teams"].as_bool();
        if tick["game_ended_this_tick"].as_bool() == Some(true) {
            self.first_ended_tick.get_or_insert(ordinal);
        }
        if !ordinal.is_multiple_of(4) {
            return Ok(());
        }
        self.flush_pending()?;
        let mut selected = json!({
            "multiplayer_map_name": tick["multiplayer_map_name"],
            "game_time_info": {"game_time": ordinal / 4,
                "elapsed_seconds": ordinal as f64 / 120.0},
            "players": players.iter().map(|player| {
                let mut selected = selected_player(player);
                // The viewer retains corpses, but occupancy measures living players.
                selected["player_object_data"] = if (self.revision >= 2 && self.first_ended_tick.is_some()) || player["object_ref"] == -1 {
                    Value::Null
                } else if let Some(body) = player["player_object_data"].as_object() {
                    Value::Object(["x", "y", "z"].iter().filter_map(|key|
                        body.get(*key).map(|value| ((*key).into(), value.clone()))).collect())
                } else { Value::Null };
                selected
            }).collect::<Vec<_>>()
        });
        if ordinal == 0 {
            selected["spawns"] = tick["spawns"].clone();
        }
        self.pending = Some(selected);
        Ok(())
    }

    fn flush_pending(&mut self) -> Result<(), Box<dyn Error>> {
        if let Some(tick) = self.pending.take() {
            if self.samples > 0 {
                self.output.write_all(b",")?;
            }
            serde_json::to_writer(&mut self.output, &tick)?;
            self.samples += 1;
        }
        Ok(())
    }

    pub fn finish(
        mut self,
        metadata: &Map<String, Value>,
        context: &Value,
        source_ticks: usize,
    ) -> Result<Value, Box<dyn Error>> {
        let pending = self
            .pending
            .as_mut()
            .ok_or("analytics contains no samples")?;
        // Final scores must include events in the last partial four-tick interval.
        // Keep positions on the sampling lattice; only replace summary counters.
        for player in pending["players"]
            .as_array_mut()
            .ok_or("missing final players")?
        {
            if let Some(final_player) = self
                .final_players
                .iter()
                .find(|value| value["player_index"] == player["player_index"])
            {
                player
                    .as_object_mut()
                    .unwrap()
                    .extend(final_player.as_object().unwrap().clone());
            }
        }
        if self.revision >= 4 {
            let players = pending["players"].as_array_mut().unwrap();
            for final_player in &self.final_players {
                if !players.iter().any(|player| player["player_index"] == final_player["player_index"]) {
                    let mut retained = final_player.clone();
                    retained["player_object_data"] = Value::Null;
                    players.push(retained);
                }
            }
            players.sort_by_key(|player| player["player_index"].as_u64());
        }
        self.flush_pending()?;
        let statistics_source_ticks = if self.revision == 1 {
            source_ticks
        } else {
            self.first_ended_tick.map_or(source_ticks, |end| end + 1)
        };
        if self.samples != statistics_source_ticks.div_ceil(4) {
            return Err("analytics sample count differs from source".into());
        }
        let mut root = metadata.clone();
        if let Some(end) = self.first_ended_tick {
            let seconds = end / 120;
            root.get_mut("summary").ok_or("missing analytics summary")?["game_duration_ingame"] =
                json!(format!(
                    "{}:{:02}:{:09.6}",
                    seconds / 3600,
                    seconds / 60 % 60,
                    end as f64 / 120.0 % 60.0
                ));
        }
        let mode = match self.game_type {
            Some(1) => "ctf",
            Some(2) => "slayer",
            Some(3) => "oddball",
            Some(4) => "king",
            Some(5) => "race",
            _ => return Err("unsupported game mode".into()),
        };
        root.insert(
            "gametype_settings".into(),
            json!({"mode": mode,
            "name": context["gametype"], "teams_enabled": self.has_teams}),
        );
        root.insert(
            "h1_analytics".into(),
            json!({
                "schema": "halospawns.h1AnalyticsSource.v1", "context": context,
                "source_ticks": source_ticks, "source_tick_rate": 120,
                "analytics_tick_rate": 30, "position_stride": 4,
                "analytics_revision": self.revision, "statistics_source_ticks": statistics_source_ticks,
                "counters": if self.revision == 1 { "observed_every_source_tick" } else { "match_only_observed_every_source_tick" },
                "postgame": if self.revision == 1 { "retained" } else { "excluded_from_statistics_retained_in_viewer" },
                "host_topology": "unavailable", "corpse_positions": "excluded",
            }),
        );
        self.output.write_all(b"]")?;
        for (key, value) in root {
            self.output.write_all(b",")?;
            serde_json::to_writer(&mut self.output, &key)?;
            self.output.write_all(b":")?;
            serde_json::to_writer(&mut self.output, &value)?;
        }
        self.output.write_all(b"}")?;
        let raw_bytes = self.output.bytes;
        let mut file = self.output.inner.into_inner()
            .map_err(|error| error.into_error())?.finish()?;
        file.flush()?;
        let bytes = file.get_ref().metadata()?.len();
        if bytes > 64 * 1024 * 1024 {
            return Err("compressed analytics exceeds 64 MiB".into());
        }
        Ok(
            json!({"schema":"halospawns.h1AnalyticsSource.v1", "ticks":self.samples,
            "match_end_source_tick":self.first_ended_tick,
            "analytics_revision":self.revision, "statistics_source_ticks":statistics_source_ticks,
            "ticks_per_second":30, "uncompressed_bytes":raw_bytes, "size_bytes":bytes}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffered_compression_matches_fragmented_writes_and_retains_raw_limit() {
        let mut reference = Bounded {
            inner: zstd::stream::write::Encoder::new(Vec::new(), 3).unwrap(),
            bytes: 0,
        };
        let mut buffered = Bounded {
            inner: BufWriter::with_capacity(
                64 * 1024,
                zstd::stream::write::Encoder::new(Vec::new(), 3).unwrap(),
            ),
            bytes: 0,
        };
        for ordinal in 0..4096 {
            let value = json!({"tick":ordinal,"players":[{"name":"Player",
                "x":-0.0,"y":ordinal as f64 / 120.0,"kills":1}],"absent":null});
            serde_json::to_writer(&mut reference, &value).unwrap();
            serde_json::to_writer(&mut buffered, &value).unwrap();
        }
        assert!(buffered.bytes > 128 * 1024);
        assert_eq!(buffered.bytes, reference.bytes);
        let actual = buffered.inner.into_inner()
            .map_err(|error| error.into_error()).unwrap().finish().unwrap();
        assert_eq!(actual, reference.inner.finish().unwrap());
        let mut limited = Bounded { inner: BufWriter::new(Vec::new()), bytes: MAX_RAW_BYTES - 1 };
        assert!(limited.write_all(b"xx").is_err());
        assert_eq!(limited.bytes, MAX_RAW_BYTES - 1);
        assert!(limited.inner.buffer().is_empty());
    }

    #[test]
    fn partial_tail_keeps_final_scores_without_adding_occupancy_or_fake_host_facts() {
        let path = std::env::temp_dir().join(format!("h1-analytics-{}.zst", std::process::id()));
        let mut writer = Export::new(&path).unwrap();
        for i in 0..6 {
            writer
                .observe(
                    &json!({"game_type":2,"game_engine_has_teams":true,
                "multiplayer_map_name":"dread", "game_ended_this_tick":i==5,
                "spawns":[{"x":1,"y":2,"z":3}],
                "players":[{"player_index":0,"local_player":0,"kills":i,
                    "object_ref":if i==4 {-1} else {1},
                    "model_nodes":[[1,2,3]],"player_object_data":{"x":i,"y":1,"z":2}}]}),
                    i,
                )
                .unwrap();
        }
        let result = writer
            .finish(
                &json!({"summary":{"is_full_game":true},
            "game_meta":{},"events":[]})
                .as_object()
                .unwrap()
                .clone(),
                &json!({"gametype":"Team Slayer"}),
                6,
            )
            .unwrap();
        assert_eq!(result["ticks"], 2);
        let raw = zstd::decode_all(File::open(&path).unwrap()).unwrap();
        let value: Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(value["ticks"][0]["players"][0]["kills"], 0);
        assert_eq!(value["ticks"][1]["players"][0]["kills"], 5);
        assert!(value["ticks"][1]["players"][0]["player_object_data"].is_null());
        assert!(
            value["ticks"][0]["players"][0]
                .get("local_player")
                .is_none()
        );
        assert!(value["ticks"][0]["players"][0].get("model_nodes").is_none());
        assert_eq!(value["gametype_settings"]["mode"], "slayer");
        assert_eq!(value["summary"]["game_duration_ingame"], "0:00:00.041667");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn revision_four_retains_departed_and_unsampled_players_without_adding_positions() {
        for revision in [3, 4] {
            for end in [None, Some(5)] {
                let path = std::env::temp_dir().join(format!(
                    "h1-roster-{}-{revision}-{end:?}.zst", std::process::id()
                ));
                let mut writer = Export::with_revision(&path, revision).unwrap();
                for ordinal in 0..7 {
                    let mut players = vec![json!({
                        "player_index":0,"name":"Stays","kills":ordinal,
                        "object_ref":1,"player_object_data":{"x":ordinal,"y":1,"z":2}
                    })];
                    if ordinal < 3 {
                        players.push(json!({
                            "player_index":1,"name":"Leaves","kills":ordinal,
                            "player_quit":ordinal==2,"object_ref":2,
                            "player_object_data":{"x":10,"y":1,"z":2}
                        }));
                    }
                    if ordinal == 5 {
                        players.push(json!({
                            "player_index":2,"name":"Between samples","kills":3,
                            "object_ref":3,"player_object_data":{"x":20,"y":1,"z":2}
                        }));
                    }
                    writer.observe(&json!({
                        "game_type":2,"game_engine_has_teams":false,
                        "multiplayer_map_name":"dread",
                        "game_ended_this_tick":end==Some(ordinal),"players":players
                    }), ordinal).unwrap();
                }
                writer.finish(
                    json!({"summary":{},"game_meta":{},"events":[]}).as_object().unwrap(),
                    &json!({"gametype":"Slayer"}), 7
                ).unwrap();
                let raw = zstd::decode_all(File::open(&path).unwrap()).unwrap();
                let value: Value = serde_json::from_slice(&raw).unwrap();
                let ticks = value["ticks"].as_array().unwrap();
                assert_eq!(ticks.len(), 2);
                let players = ticks.last().unwrap()["players"].as_array().unwrap();
                assert_eq!(players[0]["kills"], end.unwrap_or(6));
                assert_eq!(players[0]["player_object_data"]["x"], 4);
                assert_eq!(players.len(), if revision == 4 { 3 } else { 1 });
                if revision == 4 {
                    assert_eq!(players[1]["name"], "Leaves");
                    assert_eq!(players[1]["kills"], 2);
                    assert_eq!(players[1]["player_quit"], true);
                    assert_eq!(players[2]["name"], "Between samples");
                    assert_eq!(players[2]["kills"], 3);
                    assert!(players[1]["player_object_data"].is_null());
                    assert!(players[2]["player_object_data"].is_null());
                }
                std::fs::remove_file(path).unwrap();
            }
        }
    }

    #[test]
    fn bounded_writer_rejects_excess_before_writing() {
        let mut writer = Bounded {
            inner: Vec::new(),
            bytes: MAX_RAW_BYTES,
        };
        assert!(writer.write_all(b"x").is_err());
        assert!(writer.inner.is_empty());
    }
}
