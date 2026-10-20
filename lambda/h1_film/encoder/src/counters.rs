use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::Value;
use std::ops::Index;

const FIELDS: [&str; 16] = [
    "kills",
    "deaths",
    "assists",
    "suicides",
    "team_kills",
    "shots_fired",
    "shots_hit",
    "score",
    "ctf_score",
    "damage_dealt",
    "damage_received",
    "camo_count",
    "overshield_count",
    "unit",
    "primary_nades",
    "secondary_nades",
];

#[derive(Clone)]
pub struct Counters([Option<Value>; 16]);

impl Counters {
    pub fn from_player(player: &Value, metadata: &Value) -> Self {
        Self(std::array::from_fn(|index| match index {
            0..=8 => player.get(FIELDS[index]).cloned(),
            9..=12 => metadata.get(FIELDS[index]).cloned(),
            13 => Some(player["object_ref"].clone()),
            _ => Some(player["player_object_data"][FIELDS[index]].clone()),
        }))
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        let index = match key {
            "kills" => 0,
            "deaths" => 1,
            "assists" => 2,
            "suicides" => 3,
            "team_kills" => 4,
            "shots_fired" => 5,
            "shots_hit" => 6,
            "score" => 7,
            "ctf_score" => 8,
            "damage_dealt" => 9,
            "damage_received" => 10,
            "camo_count" => 11,
            "overshield_count" => 12,
            "unit" => 13,
            "primary_nades" => 14,
            "secondary_nades" => 15,
            _ => return None,
        };
        self.0[index].as_ref()
    }
}

impl Index<&str> for Counters {
    type Output = Value;

    fn index(&self, key: &str) -> &Value {
        self.get(key).unwrap_or(&Value::Null)
    }
}

impl Serialize for Counters {
    fn serialize<Output: Serializer>(&self, output: Output) -> Result<Output::Ok, Output::Error> {
        let mut map = output.serialize_map(Some(self.0.iter().flatten().count()))?;
        for (key, value) in FIELDS.iter().zip(&self.0) {
            if let Some(value) = value {
                map.serialize_entry(key, value)?;
            }
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retains_counter_order_types_absence_and_nulls() {
        let player = json!({"kills":2,"deaths":null,"score":-1,"object_ref":4294967295u64,
            "player_object_data":{"primary_nades":3}});
        let metadata = json!({"damage_dealt":12.5,"damage_received":-0.0});
        let counters = Counters::from_player(&player, &metadata);
        let expected = json!({"kills":2,"deaths":null,"score":-1,"damage_dealt":12.5,
            "damage_received":-0.0,"unit":4294967295u64,"primary_nades":3,"secondary_nades":null});
        assert_eq!(
            serde_json::to_vec(&counters).unwrap(),
            serde_json::to_vec(&expected).unwrap()
        );
        assert!(counters.get("deaths").unwrap().is_null());
        assert!(counters.get("assists").is_none());
        assert_eq!(counters["unit"].as_u64(), Some(4294967295));
    }
}
