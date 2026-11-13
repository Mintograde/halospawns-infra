//! Host-only private observations, removed before viewer serialization.
use serde_json::{Value, json};
use std::{error::Error, fs::File, io::{BufWriter, Write}, path::Path};
use std::collections::BTreeSet;

pub struct Evidence {
    output: BufWriter<File>,
    enabled: Option<bool>,
    ended: bool,
    bytes: usize,
    units: BTreeSet<(u64, u64)>,
}

impl Evidence {
    pub fn new(path: &Path) -> Result<Self, Box<dyn Error>> {
        Ok(Self { output: BufWriter::new(File::options().write(true).create_new(true).open(path)?),
            enabled: None, ended: false, bytes: 0, units: BTreeSet::new() })
    }
    pub fn observe(&mut self, tick: &Value, ordinal: usize) -> Result<(), Box<dyn Error>> {
        let present = tick.get("spawn_events").is_some();
        if self.enabled.replace(present).is_some_and(|old| old != present) {
            return Err("inconsistent spawn evidence".into());
        }
        if !present { return Ok(()); }
        let mut events = tick["spawn_events"].as_array().ok_or("invalid spawn events")?.clone();
        if events.len() > 64 { return Err("spawn frame budget exceeded".into()); }
        for event in &events {
            let slot = event["slot_index"].as_u64().ok_or("invalid spawn participant")?;
            let unit = event["unit_handle"].as_u64().ok_or("invalid spawn unit")?;
            if !self.units.insert((slot, unit)) { return Err("duplicate spawn unit".into()); }
        }
        // A body created by an uninstrumented/forced network path has no selection
        // evidence. Count it as unknown instead of silently claiming full coverage.
        for player in tick["players"].as_array().ok_or("missing spawn roster")? {
            let slot = player["player_index"].as_u64().ok_or("invalid spawn roster")?;
            if let Some(unit) = player["object_ref"].as_u64().filter(|u| *u < u32::MAX as u64) {
                if self.units.insert((slot, unit)) {
                    events.push(json!({"slot_index":slot,"unit_handle":unit,"spawn_index":null,"ratings":null}));
                }
            }
        }
        if events.len() > 64 || self.units.len() > 16384 { return Err("spawn observation budget exceeded".into()); }
        // Match the existing pre-end native counter boundary.
        self.ended |= tick["game_ended_this_tick"].as_bool() == Some(true);
        if !self.ended && (!events.is_empty() || ordinal == 0) {
            let mut line = serde_json::to_vec(&json!({"source_tick":ordinal,"events":events}))?;
            line.push(b'\n');
            self.bytes += line.len();
            if self.bytes > 64 * 1024 * 1024 { return Err("spawn evidence budget exceeded".into()); }
            self.output.write_all(&line)?;
        }
        Ok(())
    }
    pub fn finish(mut self) -> Result<(), Box<dyn Error>> { self.output.flush()?; Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_end_and_postgame_and_rejects_missing_frames() {
        let path = std::env::temp_dir().join(format!("h1-spawns-{}.ndjson", std::process::id()));
        let mut e = Evidence::new(&path).unwrap();
        e.observe(&json!({"players":[{"player_index":0,"object_ref":123}],"spawn_events":[]}), 0).unwrap();
        e.observe(&json!({"players":[],"spawn_events":[],"game_ended_this_tick":true}), 1).unwrap();
        e.observe(&json!({"players":[],"spawn_events":[]}), 2).unwrap();
        assert!(e.observe(&json!({}), 3).is_err());
        e.finish().unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 1);
        std::fs::remove_file(path).unwrap();
    }
}
