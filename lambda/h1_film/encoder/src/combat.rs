use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

type Result<T> = std::result::Result<T, Box<dyn Error>>;
type ShotKey = (u8, String);
type DamageKey = (Option<u8>, u8, Option<String>, String);
const MAX_DISCHARGES: usize = 65_536;
const MAX_BYTES: usize = 1024 * 1024;

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Weapon {
    weapon_id: String,
    tag_path: String,
    category: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Shot {
    discharge_id: u32,
    slot_index: u8,
    weapon_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Damage {
    discharge_id: Option<u32>,
    attacker_slot: Option<u8>,
    victim_slot: u8,
    weapon_id: Option<String>,
    relationship: String,
    shield_damage: f64,
    health_damage: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Death {
    killer_slot: Option<u8>,
    victim_slot: u8,
    weapon_id: Option<String>,
    kind: String,
    headshot: Option<bool>,
    killer_position: Option<[f64; 3]>,
    victim_position: Option<[f64; 3]>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Award {
    slot_index: u8,
    longest_kill_streak: u32,
    double_kills: u32,
    triple_kills: u32,
    overkills: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Frame {
    schema: String,
    coverage: [u8; 4],
    weapons: Vec<Weapon>,
    shots: Vec<Shot>,
    damage: Vec<Damage>,
    deaths: Vec<Death>,
    awards: Vec<Award>,
}

#[derive(Default)]
pub struct Combat {
    seen: bool,
    missing: bool,
    partial_recording: bool,
    ended: bool,
    coverage: [u8; 4],
    slots: BTreeSet<u8>,
    weapons: BTreeMap<String, Weapon>,
    shots: BTreeMap<ShotKey, (u32, u32)>,
    discharges: BTreeMap<u32, (ShotKey, bool)>,
    last_discharge: u32,
    damage: BTreeMap<DamageKey, (f64, f64)>,
    deaths: Vec<Value>,
    next_event: u32,
    awards: BTreeMap<u8, Award>,
}

impl Combat {
    pub fn new(network_recording: bool) -> Self {
        let mut collector = Self::default();
        if network_recording {
            collector.coverage[0] = 1;
            collector.coverage[1] = 1;
        }
        collector
    }

    pub fn observe(&mut self, tick: &Value, ordinal: usize) -> Result<()> {
        if ordinal == 0 {
            self.partial_recording = tick["current_tick"].as_u64().is_some_and(|clock| clock != 0);
        }
        for player in tick["players"].as_array().ok_or("missing combat roster")? {
            let slot = player["player_index"].as_u64().filter(|slot| *slot < 4)
                .ok_or("invalid combat roster")? as u8;
            self.slots.insert(slot);
        }
        if self.ended {
            return Ok(());
        }
        self.ended = tick["game_ended_this_tick"].as_bool() == Some(true);
        if ordinal == 0 && self.ended {
            self.missing = true;
        }
        let Some(value) = tick.get("combat") else {
            self.missing = true;
            return Ok(());
        };
        let frame: Frame = serde_json::from_value(value.clone())?;
        if frame.schema != "halospawns.h1CombatSource.v1"
            || frame.coverage.iter().any(|value| *value > 2)
            || frame.weapons.len() > 64 || frame.shots.len() > 256
            || frame.damage.len() > 1024 || frame.deaths.len() > 64 || frame.awards.len() > 4 {
            return Err("invalid combat source envelope".into());
        }
        self.seen = true;
        for (current, incoming) in self.coverage.iter_mut().zip(frame.coverage) {
            *current = (*current).max(incoming);
        }
        for weapon in frame.weapons {
            if weapon.weapon_id.is_empty() || weapon.weapon_id.len() > 64
                || !weapon.weapon_id.bytes().enumerate().all(|(index, character)|
                    character.is_ascii_lowercase() || character.is_ascii_digit()
                    || (index > 0 && b"_.-".contains(&character)))
                || weapon.tag_path.is_empty() || weapon.tag_path.chars().count() > 240
                || !["weapon", "grenade", "melee", "vehicle", "environment"].contains(&weapon.category.as_str()) {
                return Err("invalid combat weapon".into());
            }
            if let Some(previous) = self.weapons.get(&weapon.weapon_id) {
                if previous != &weapon {
                    return Err("combat weapon identity changed".into());
                }
            } else if self.weapons.len() == 64 {
                return Err("combat catalogue exceeds limit".into());
            }
            self.weapons.insert(weapon.weapon_id.clone(), weapon);
        }
        for shot in frame.shots {
            self.slot(Some(shot.slot_index))?;
            self.weapon(Some(&shot.weapon_id))?;
            if shot.discharge_id <= self.last_discharge {
                return Err("combat discharges are not unique and ordered".into());
            }
            self.last_discharge = shot.discharge_id;
            let key = (shot.slot_index, shot.weapon_id);
            let summary = self.shots.entry(key.clone()).or_default();
            summary.0 = summary.0.checked_add(1).ok_or("shot counter overflow")?;
            if self.discharges.len() == MAX_DISCHARGES {
                self.discharges.pop_first();
                self.coverage[0] = 2;
            }
            self.discharges.insert(shot.discharge_id, (key, false));
        }
        for damage in frame.damage {
            self.slot(damage.attacker_slot)?;
            self.slot(Some(damage.victim_slot))?;
            self.weapon(damage.weapon_id.as_deref())?;
            if ![damage.shield_damage, damage.health_damage].iter()
                .all(|value| value.is_finite() && *value >= 0.0 && *value <= 9_007_199_254_740_991.0)
                || damage.shield_damage + damage.health_damage <= 0.0
                || !match damage.relationship.as_str() {
                    "opponent" | "friendly" => damage.attacker_slot.is_some_and(|slot| slot != damage.victim_slot),
                    "self" => damage.attacker_slot == Some(damage.victim_slot),
                    "environment" => damage.attacker_slot.is_none(),
                    "unknown" => true,
                    _ => false,
                } {
                return Err("invalid applied combat damage".into());
            }
            if damage.relationship == "opponent" {
                if let Some(discharge) = damage.discharge_id {
                    if let Some((key, hit)) = self.discharges.get_mut(&discharge) {
                        if Some(key.0) != damage.attacker_slot || Some(&key.1) != damage.weapon_id.as_ref() {
                            return Err("damage contradicts discharge lineage".into());
                        }
                        if !*hit {
                            self.shots.get_mut(key).unwrap().1 += 1;
                            *hit = true;
                        }
                    } else {
                        self.coverage[0] = self.coverage[0].max(1);
                    }
                }
            }
            let key = (damage.attacker_slot, damage.victim_slot, damage.weapon_id, damage.relationship);
            if self.damage.len() == 2048 && !self.damage.contains_key(&key) {
                self.coverage[1] = 2;
                continue;
            }
            let total = self.damage.entry(key).or_default();
            total.0 += damage.shield_damage;
            total.1 += damage.health_damage;
            if total.0 > 9_007_199_254_740_991.0 || total.1 > 9_007_199_254_740_991.0 {
                return Err("combat damage total overflow".into());
            }
        }
        for death in frame.deaths {
            self.slot(death.killer_slot)?;
            self.slot(Some(death.victim_slot))?;
            self.weapon(death.weapon_id.as_deref())?;
            if !match death.kind.as_str() {
                "kill" | "betrayal" => death.killer_slot.is_some_and(|slot| slot != death.victim_slot),
                "suicide" => death.killer_slot == Some(death.victim_slot),
                "environment" => death.killer_slot.is_none(),
                "unknown" => true,
                _ => false,
            } || (death.killer_slot.is_none() && death.killer_position.is_some())
                || (death.headshot == Some(true) && (death.kind != "kill" || death.weapon_id.is_none()))
                || death.killer_position.iter().chain(death.victim_position.iter())
                    .flatten().any(|value| !value.is_finite() || value.abs() > 1e6) {
                return Err("invalid combat death".into());
            }
            let mut event = serde_json::to_value(death)?;
            event["event_index"] = json!(self.next_event);
            event["source_tick"] = json!(ordinal);
            self.next_event += 1;
            if self.deaths.len() == 8192 {
                self.coverage[2] = 2;
            } else {
                self.deaths.push(event);
            }
        }
        let mut award_slots = BTreeSet::new();
        for award in frame.awards {
            self.slot(Some(award.slot_index))?;
            if !award_slots.insert(award.slot_index) {
                return Err("duplicate combat award slot".into());
            }
            if let Some(previous) = self.awards.get(&award.slot_index) {
                if award.longest_kill_streak < previous.longest_kill_streak
                    || award.double_kills < previous.double_kills
                    || award.triple_kills < previous.triple_kills
                    || award.overkills < previous.overkills {
                    return Err("combat awards decreased".into());
                }
            }
            self.awards.insert(award.slot_index, award);
        }
        Ok(())
    }

    fn slot(&self, slot: Option<u8>) -> Result<()> {
        if slot.is_some_and(|slot| !self.slots.contains(&slot)) {
            return Err("combat observation references unknown roster slot".into());
        }
        Ok(())
    }

    fn weapon(&self, weapon: Option<&str>) -> Result<()> {
        if weapon.is_some_and(|weapon| !self.weapons.contains_key(weapon)) {
            return Err("combat observation references unknown weapon".into());
        }
        Ok(())
    }

    pub fn product(mut self) -> Result<Value> {
        if self.awards.keys().copied().collect::<BTreeSet<_>>() != self.slots {
            self.coverage[3] = self.coverage[3].max(1);
        }
        let coverage = |level| {
            if !self.seen {
                json!({"status":"unavailable","reason":"unsupported_exporter"})
            } else if level == 2 {
                json!({"status":"partial","reason":"capped"})
            } else if level == 1 || self.missing {
                json!({"status":"partial","reason":"missing_evidence"})
            } else if self.partial_recording {
                json!({"status":"partial","reason":"partial_recording"})
            } else {
                json!({"status":"complete","reason":null})
            }
        };
        let mut product = json!({
            "provenance":"simulation_hooks_v1","coordinate_space":"halo1.replay_world.v1",
            "damage_unit":"h1_applied_vitality","shot_unit":"discharge",
            "hit_policy":"discharge_hit_opponent_once","position_sample":"death_callback",
            "weapons":self.weapons.into_values().collect::<Vec<_>>(),
            "shot_coverage":coverage(self.coverage[0]),"damage_coverage":coverage(self.coverage[1]),
            "death_coverage":coverage(self.coverage[2]),"award_coverage":coverage(self.coverage[3]),
            "shots":self.shots.into_iter().map(|((slot, weapon), (fired, hit))| json!({
                "slot_index":slot,"weapon_id":weapon,"shots_fired":fired,"shots_hit":hit
            })).collect::<Vec<_>>(),
            "damage":self.damage.into_iter().map(|((attacker, victim, weapon, relationship), (shield, health))| json!({
                "attacker_slot":attacker,"victim_slot":victim,"weapon_id":weapon,"relationship":relationship,
                "shield_damage":shield,"health_damage":health
            })).collect::<Vec<_>>(),
            "deaths":self.deaths,"awards":self.awards.into_values().collect::<Vec<_>>(),
        });
        let budget = MAX_BYTES - 64 * 1024;
        if serde_json::to_vec(&product)?.len() > budget {
            product["death_coverage"] = json!({"status":"partial","reason":"capped"});
            let mut bytes = serde_json::to_vec(&product)?.len();
            while bytes > budget {
                let events = product["deaths"].as_array_mut().unwrap();
                let removed = events.pop().ok_or("combat summaries exceed byte budget")?;
                bytes -= serde_json::to_vec(&removed)?.len() + usize::from(!events.is_empty());
            }
        }
        Ok(product)
    }
}

#[cfg(test)]
#[path = "combat_tests.rs"]
mod tests;
