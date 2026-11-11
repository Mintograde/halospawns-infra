//! Original PGCR counters, not projectile-attributed or inferred hits.
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

#[derive(Default)]
pub struct PistolCounters {
    enabled: Option<bool>,
    ended: bool,
    players: BTreeMap<u64, Option<(u64, u64)>>,
}

impl PistolCounters {
    pub fn observe(&mut self, tick: &Value) -> Result<(), Box<dyn Error>> {
        let present = tick.get("pistol_counters").is_some();
        if self
            .enabled
            .replace(present)
            .is_some_and(|previous| previous != present)
        {
            return Err("inconsistent pistol counter export".into());
        }
        if !present {
            return Ok(());
        }
        let rows = tick["pistol_counters"]
            .as_array()
            .ok_or("invalid pistol counters")?;
        let active = tick["players"].as_array().ok_or("missing pistol roster")?;
        let mut seen = BTreeSet::new();
        for row in rows {
            let slot = row["slot_index"]
                .as_u64()
                .filter(|s| *s < 16)
                .ok_or("invalid pistol slot")?;
            if !seen.insert(slot) {
                return Err("duplicate pistol slot".into());
            }
            let player = active
                .iter()
                .find(|p| p["player_index"].as_u64() == Some(slot))
                .ok_or("pistol slot absent from roster")?;
            let previous = self.players.entry(slot).or_default();
            // Match the established PGCR/overall-accuracy boundary. Never count
            // postgame firing, including the ambiguous transition snapshot.
            if self.ended || tick["game_ended_this_tick"].as_bool() == Some(true) {
                continue;
            }
            let fired = row["shots_fired"]
                .as_u64()
                .ok_or("invalid pistol fired counter")?;
            let hit = row["shots_hit"]
                .as_u64()
                .ok_or("invalid pistol hit counter")?;
            if hit > fired
                || fired
                    > player["shots_fired"]
                        .as_u64()
                        .ok_or("missing overall shots")?
                || hit > player["shots_hit"].as_u64().ok_or("missing overall hits")?
                || fired > 9_007_199_254_740_991
                || previous.is_some_and(|(f, h)| fired < f || hit < h)
            {
                return Err("inconsistent pistol counters".into());
            }
            *previous = Some((fired, hit));
        }
        if seen.len() != active.len() {
            return Err("incomplete pistol roster".into());
        }
        self.ended |= tick["game_ended_this_tick"].as_bool() == Some(true);
        Ok(())
    }

    pub fn product(&self) -> Option<Value> {
        (self.enabled == Some(true)).then(|| {
            json!({
                "schema":"halospawns.h1PistolAccuracy.v1",
                "method":"pgcr_player_latch", "boundary_policy":"pre_end_snapshot",
                "players":self.players.iter().map(|(slot, counters)| json!({
                    "slot_index":slot, "shots_fired":counters.map(|p| p.0),
                    "shots_hit":counters.map(|p| p.1)
                })).collect::<Vec<_>>()
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tick(fired: u64, hit: u64, ended: bool) -> Value {
        json!({"players":[{"player_index":0,"shots_fired":fired+2,"shots_hit":hit+1}],
            "pistol_counters":[{"slot_index":0,"shots_fired":fired,"shots_hit":hit}],
            "game_ended_this_tick":ended})
    }
    #[test]
    fn keeps_pgcr_pair_and_freezes_before_end_without_touching_other_evidence() {
        let mut counters = PistolCounters::default();
        for t in [
            tick(0, 0, false),
            tick(4, 2, false),
            tick(5, 3, true),
            tick(20, 10, false),
        ] {
            counters.observe(&t).unwrap();
        }
        assert_eq!(
            counters.product().unwrap()["players"][0],
            json!({"slot_index":0,"shots_fired":4,"shots_hit":2})
        );
    }
    #[test]
    fn distinguishes_unavailable_from_zero_and_retains_legacy_absence() {
        let mut old = PistolCounters::default();
        old.observe(&json!({})).unwrap();
        assert!(old.product().is_none());
        let mut empty = PistolCounters::default();
        empty.observe(&tick(0, 0, true)).unwrap();
        assert!(empty.product().unwrap()["players"][0]["shots_fired"].is_null());
        let mut zero = PistolCounters::default();
        zero.observe(&tick(0, 0, false)).unwrap();
        assert_eq!(zero.product().unwrap()["players"][0]["shots_hit"], 0);
    }
    #[test]
    fn rejects_incomplete_conflicting_or_decreasing_evidence() {
        for bad in [
            tick(1, 2, false),
            json!({"players":[],"pistol_counters":[{"slot_index":0}]}),
            json!({"players":[{"player_index":0}],"pistol_counters":[]}),
        ] {
            assert!(PistolCounters::default().observe(&bad).is_err());
        }
        let mut counters = PistolCounters::default();
        counters.observe(&tick(3, 2, false)).unwrap();
        assert!(counters.observe(&tick(2, 1, false)).is_err());
        assert!(counters.observe(&json!({})).is_err());
    }
}
