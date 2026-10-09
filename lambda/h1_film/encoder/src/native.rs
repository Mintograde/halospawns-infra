use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::error::Error;

const METRICS: &[(&str, &str)] = &[
    ("pgcr_damage_dealt", "damage_dealt"),
    ("vitality_damage_received", "damage_received"),
    ("camo_pickups", "camo_count"),
    ("overshield_pickups", "overshield_count"),
];
const MAX_POINTS: usize = 16_384;
const MAX_METRIC_POINTS: usize = 4_096;

struct Metric {
    value: Value,
    series: Option<Vec<Value>>,
}

impl Default for Metric {
    fn default() -> Self {
        Self {
            value: Value::Null,
            series: Some(Vec::new()),
        }
    }
}

#[derive(Default)]
pub struct NativeAnalytics {
    players: BTreeMap<u64, BTreeMap<&'static str, Metric>>,
    points: usize,
    ended: bool,
}

impl NativeAnalytics {
    // Observe the original 120 Hz snapshots before the common adapter freezes
    // end-tick counters. These timelines are cumulative, never sampled deltas.
    pub fn observe(&mut self, tick: &Value, ordinal: usize) -> Result<(), Box<dyn Error>> {
        let players = tick["players"].as_array().ok_or("missing native players")?;
        for player in players {
            let slot = player["player_index"]
                .as_u64()
                .filter(|slot| *slot < 4)
                .ok_or("invalid native slot")?;
            let metrics = self.players.entry(slot).or_insert_with(|| {
                METRICS
                    .iter()
                    .map(|(name, _)| (*name, Metric::default()))
                    .collect()
            });
            if self.ended || tick["game_ended_this_tick"].as_bool() == Some(true) {
                continue;
            }
            for &(name, source) in METRICS {
                let value = &tick["game_meta"]["players"][slot.to_string()][source];
                let metric = metrics.get_mut(name).unwrap();
                if value.is_null() {
                    self.points -= metric.series.take().map_or(0, |series| series.len());
                    metric.value = Value::Null;
                    continue;
                }
                let number = value
                    .as_f64()
                    .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 9_007_199_254_740_991.0)
                    .ok_or("invalid native counter")?;
                if name != "vitality_damage_received" && value.as_u64().is_none() {
                    return Err("native integer counter has fractional representation".into());
                }
                if metric
                    .value
                    .as_f64()
                    .is_some_and(|previous| number < previous)
                {
                    return Err("native counter decreased within observed coverage".into());
                }
                if let Some(series) = &mut metric.series {
                    // Record the first observed baseline, including zero. A
                    // partial recording does not establish a zero before it.
                    if metric.value != *value {
                        if series.len() == MAX_METRIC_POINTS || self.points == MAX_POINTS {
                            self.points -= series.len();
                            metric.series = None;
                        } else {
                            series.push(json!({"source_tick":ordinal,"value":value}));
                            self.points += 1;
                        }
                    }
                }
                metric.value = value.clone();
            }
        }
        self.ended |= tick["game_ended_this_tick"].as_bool() == Some(true);
        Ok(())
    }

    pub fn product(&self) -> Value {
        json!({"schema":"halospawns.h1NativeAnalytics.v1",
            "players":self.players.iter().map(|(slot, metrics)| json!({
                "slot_index":slot,
                "metrics":metrics.iter().map(|(name, metric)| ((*name).to_owned(), json!({
                    "value":metric.value,
                    "series":if metric.value.is_null() { None } else { metric.series.as_ref() }
                }))).collect::<serde_json::Map<_,_>>()
            })).collect::<Vec<_>>()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tick(value: Value, ended: bool) -> Value {
        json!({"game_ended_this_tick":ended,"players":[{"player_index":0}],
            "game_meta":{"players":{"0":{"damage_dealt":value,"damage_received":1.125,
                "camo_count":0,"overshield_count":2}}}})
    }

    #[test]
    fn native_timelines_keep_precision_baselines_and_exclude_the_ending_update() {
        let mut native = NativeAnalytics::default();
        for (i, value) in [5, 5, 8, 100, 200].into_iter().enumerate() {
            native.observe(&tick(json!(value), i >= 3), i).unwrap();
        }
        let product = native.product();
        let metrics = &product["players"][0]["metrics"];
        assert_eq!(
            metrics["pgcr_damage_dealt"],
            json!({"value":8,"series":[
            {"source_tick":0,"value":5},{"source_tick":2,"value":8}]})
        );
        assert_eq!(metrics["vitality_damage_received"]["value"], 1.125);
        assert_eq!(metrics["camo_pickups"]["value"], 0);
        assert_eq!(metrics["overshield_pickups"]["series"][0]["value"], 2);
    }

    #[test]
    fn postgame_only_and_missing_snapshots_do_not_invent_totals_or_timelines() {
        let mut native = NativeAnalytics::default();
        native.observe(&tick(json!(10), true), 0).unwrap();
        assert_eq!(
            native.product()["players"][0]["metrics"]["pgcr_damage_dealt"],
            json!({"value":null,"series":null})
        );
        let mut native = NativeAnalytics::default();
        native.observe(&tick(Value::Null, false), 0).unwrap();
        native.observe(&tick(json!(10), false), 1).unwrap();
        assert_eq!(
            native.product()["players"][0]["metrics"]["pgcr_damage_dealt"],
            json!({"value":10,"series":null})
        );
    }

    #[test]
    fn capped_timeline_keeps_observed_total_without_truncating_or_decimating() {
        let mut native = NativeAnalytics::default();
        for i in 0..=MAX_METRIC_POINTS {
            native.observe(&tick(json!(i), false), i).unwrap();
        }
        assert_eq!(
            native.product()["players"][0]["metrics"]["pgcr_damage_dealt"],
            json!({"value":MAX_METRIC_POINTS,"series":null})
        );
        assert_eq!(native.points, 3);
    }

    #[test]
    fn invalid_and_decreasing_counters_fail_closed() {
        for value in [json!(-1), json!(1.5), json!(true), json!("10")] {
            assert!(
                NativeAnalytics::default()
                    .observe(&tick(value, false), 0)
                    .is_err()
            );
        }
        let mut native = NativeAnalytics::default();
        native.observe(&tick(json!(2), false), 0).unwrap();
        assert!(native.observe(&tick(json!(1), false), 1).is_err());
    }

    #[test]
    fn combined_budget_drops_whole_timelines_and_keeps_open_recording_totals() {
        let mut native = NativeAnalytics::default();
        for i in 0..2100 {
            let mut snapshot = tick(json!(i), false);
            snapshot["players"] = json!(
                (0..4)
                    .map(|slot| json!({"player_index":slot}))
                    .collect::<Vec<_>>()
            );
            for slot in 0..4 {
                snapshot["game_meta"]["players"][slot.to_string()] = json!({
                    "damage_dealt":i,"damage_received":i as f64 + 0.125,
                    "camo_count":0,"overshield_count":0});
            }
            native.observe(&snapshot, i).unwrap();
            assert!(native.points <= MAX_POINTS);
        }
        let product = native.product();
        let mut points = 0;
        let mut unavailable = 0;
        for player in product["players"].as_array().unwrap() {
            assert_eq!(player["metrics"]["pgcr_damage_dealt"]["value"], 2099);
            assert_eq!(
                player["metrics"]["vitality_damage_received"]["value"],
                2099.125
            );
            for metric in player["metrics"].as_object().unwrap().values() {
                if let Some(series) = metric["series"].as_array() {
                    points += series.len();
                    assert!(series.len() <= MAX_METRIC_POINTS);
                    assert_eq!(series.last().unwrap()["value"], metric["value"]);
                } else {
                    unavailable += 1;
                }
            }
        }
        assert_eq!(points, native.points);
        assert!(unavailable > 0);
    }
}
