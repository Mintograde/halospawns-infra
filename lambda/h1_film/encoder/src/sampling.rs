use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::error::Error;

pub fn sample_count(source_ticks: usize, stride: usize) -> usize {
    source_ticks.div_ceil(stride)
}

pub const METRICS: [(&str, &str); 6] = [
    ("kills", "kills_by_tick"),
    ("deaths", "deaths_by_tick"),
    ("assists", "assists_by_tick"),
    ("shots_fired", "shots_by_tick"),
    ("damage_dealt", "damage_dealt_by_tick"),
    ("damage_received", "damage_received_by_tick"),
];

// Events between retained states appear at the next sample, or the final sample
// when the film ends partway through a four-tick interval.
pub fn output_tick(ordinal: usize, stride: usize, count: usize) -> usize {
    ordinal.div_ceil(stride).min(count - 1)
}

pub fn retime_metadata(
    replay: &mut Map<String, Value>,
    stride: usize,
    count: usize,
) -> Result<(), Box<dyn Error>> {
    if let Some(events) = replay.get_mut("events").and_then(Value::as_array_mut) {
        for event in events {
            let parsed = event
                .as_str()
                .and_then(|text| text.split_once(':'))
                .and_then(|(tick, body)| Some((tick.parse::<usize>().ok()?, body)));
            if let Some((tick, body)) = parsed {
                *event = json!(format!("{}:{body}", output_tick(tick, stride, count)));
            }
        }
    }
    if let Some(players) = replay
        .get_mut("game_meta")
        .and_then(|meta| meta.get_mut("players"))
        .and_then(Value::as_object_mut)
    {
        for player in players.values_mut() {
            for (_, metric) in METRICS {
                let Some(series) = player.get_mut(metric).and_then(Value::as_object_mut) else {
                    continue;
                };
                let source: BTreeMap<usize, Value> = series
                    .iter()
                    .map(|(tick, value)| Ok((tick.parse::<usize>()?, value.clone())))
                    .collect::<Result<_, Box<dyn Error>>>()?;
                let mut resampled = BTreeMap::<usize, Value>::new();
                for (tick, value) in source {
                    let key = output_tick(tick, stride, count);
                    if matches!(metric, "kills_by_tick" | "deaths_by_tick") {
                        let positions = value.as_array().ok_or("expected metric positions")?;
                        let target = resampled
                            .entry(key)
                            .or_insert_with(|| json!([]))
                            .as_array_mut()
                            .unwrap();
                        target.extend(positions.iter().cloned());
                        if target.len() > 64 {
                            return Err("metric positions exceed the replay contract limit".into());
                        }
                    } else {
                        let target = resampled.entry(key).or_insert_with(|| json!(0.0));
                        *target = json!(
                            target.as_f64().unwrap()
                                + value.as_f64().ok_or("non-numeric metric delta")?
                        );
                    }
                }
                *series = resampled
                    .into_iter()
                    .map(|(tick, value)| (tick.to_string(), value))
                    .collect();
            }
        }
    }
    Ok(())
}

fn timer(object: &mut Map<String, Value>, key: &str, stride: usize) {
    if let Some(value) = object
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| *v >= 0.0)
    {
        object.insert(key.into(), json!((value / stride as f64).ceil() as u64));
    }
}

// Exact sampled poses and animation cursors, with explicitly converted units for
// timers and per-tick velocities. Authored animation frames stay at 30 fps.
pub fn normalize(
    tick: &mut Value,
    ordinal: usize,
    stride: usize,
    map: &str,
) -> Result<(), Box<dyn Error>> {
    if !ordinal.is_multiple_of(stride) {
        return Err("tick is not on the sampling lattice".into());
    }
    let clock = ordinal / stride;
    let object = tick.as_object_mut().ok_or("tick must be an object")?;
    object.insert("current_tick".into(), json!(clock));
    object.insert(
        "current_game_time_seconds".into(),
        json!(ordinal as f64 / 120.0),
    );
    object.insert("multiplayer_map_name".into(), json!(map));
    let time = object
        .get_mut("game_time_info")
        .and_then(Value::as_object_mut)
        .ok_or("missing game time")?;
    time.insert("game_time".into(), json!(clock));
    let seconds = ordinal / 120;
    time.insert(
        "real_time_elapsed".into(),
        json!(format!(
            "{}:{:02}:{:02}",
            seconds / 3600,
            seconds / 60 % 60,
            seconds % 60
        )),
    );
    if let Some(meta) = object.get_mut("game_meta").and_then(Value::as_object_mut) {
        meta.insert("map_name".into(), json!(map));
    }
    if stride != 1 {
        if let Some(players) = object.get_mut("players").and_then(Value::as_array_mut) {
            for player in players {
                let Some(player) = player.as_object_mut() else {
                    continue;
                };
                timer(player, "respawn_timer", stride);
                if let Some(body) = player
                    .get_mut("player_object_data")
                    .and_then(Value::as_object_mut)
                {
                    timer(body, "airborne_ticks", stride);
                    for key in ["x_vel", "y_vel", "z_vel"] {
                        if let Some(value) = body.get(key).and_then(Value::as_f64) {
                            body.insert(key.into(), json!(value * stride as f64));
                        }
                    }
                    if let Some(weapons) = body.get_mut("weapons").and_then(Value::as_array_mut) {
                        for weapon in weapons {
                            if let Some(weapon) = weapon.as_object_mut() {
                                timer(weapon, "reload_time", stride);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_last_intervals_keep_uniform_samples() {
        for (ticks, expected) in [(1, 1), (3, 1), (4, 1), (5, 2), (8193, 2049)] {
            assert_eq!(sample_count(ticks, 4), expected);
        }
    }
    #[test]
    fn downsampling_converts_timer_and_velocity_units_not_poses_or_animation_frames() {
        let mut tick = json!({"current_tick":104, "current_game_time_seconds":104.0/120.0,
            "game_time_info":{"game_time":104,"real_time_elapsed":"0:00:00"},
            "players":[{"respawn_timer":7,"player_object_id":4294901761u64,"x":-0.0,
                "first_person_weapon":{"animation_tick":35},
                "player_object_data":{"x":-4.0,"x_vel":0.125,"y_vel":-0.0,"z_vel":-0.25,
                "airborne_ticks":13,"melee_animation_remaining":7,
                "weapons":[{"reload_time":241},{"reload_time":-1}]}}]});
        let player = tick["players"][0].clone();
        normalize(&mut tick, 4, 4, "downrush").unwrap();
        assert_eq!(tick["current_tick"], 1);
        assert_eq!(tick["game_time_info"]["game_time"], 1);
        assert_eq!(tick["current_game_time_seconds"], 1.0 / 30.0);
        assert_eq!(tick["players"][0]["respawn_timer"], 2);
        let body = &tick["players"][0]["player_object_data"];
        assert_eq!(body["x"], player["player_object_data"]["x"]);
        assert_eq!(body["x_vel"], 0.5);
        assert!(body["y_vel"].as_f64().unwrap().is_sign_negative());
        assert_eq!(body["z_vel"], -1.0);
        assert_eq!(body["airborne_ticks"], 4);
        assert_eq!(body["melee_animation_remaining"], 7);
        assert_eq!(body["weapons"][0]["reload_time"], 61);
        assert_eq!(body["weapons"][1]["reload_time"], -1);
        assert_eq!(
            tick["players"][0]["first_person_weapon"],
            player["first_person_weapon"]
        );
        assert!(normalize(&mut tick, 5, 4, "downrush").is_err());
    }

    #[test]
    fn sparse_metadata_retains_unsampled_deltas_and_clamps_the_partial_tail() {
        let mut replay = json!({"events":["1: A died (1)","4: A spawned","8: Game ended"],
            "game_meta":{"players":{"0":{"kills_by_tick":{"1":[[1,2,3]],"2":[[4,5,6]],"8":[[null,null,null]]},
                "shots_by_tick":{"1":1,"2":1,"8":1}}}}})
        .as_object()
        .unwrap()
        .clone();
        retime_metadata(&mut replay, 4, 2).unwrap();
        assert_eq!(
            replay["events"],
            json!(["1: A died (1)", "1: A spawned", "1: Game ended"])
        );
        assert_eq!(
            replay["game_meta"]["players"]["0"]["kills_by_tick"],
            json!({"1":[[1,2,3],[4,5,6],[null,null,null]]})
        );
        assert_eq!(
            replay["game_meta"]["players"]["0"]["shots_by_tick"],
            json!({"1":3.0})
        );
    }
}
