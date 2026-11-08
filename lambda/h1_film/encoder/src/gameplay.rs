//! Private bounded evidence stream for independently versioned derived metrics.
use serde_json::{Value, json};
use std::{error::Error, fs::File, io::{BufWriter, Write}, path::Path};

pub struct Evidence {
    output: BufWriter<File>,
    bytes: usize,
    ended: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_match_ending_death_and_excludes_postgame_events() {
        let path = std::env::temp_dir().join(format!("h1-gameplay-{}.ndjson", std::process::id()));
        let mut evidence = Evidence::new(&path).unwrap();
        evidence.observe(&json!({"game_ended_this_tick":true,"gameplay":{
            "schema":"halospawns.h1GameplaySource.v1","events":[{"kind":2}]
        }}), 12).unwrap();
        evidence.observe(&json!({"gameplay":{
            "schema":"halospawns.h1GameplaySource.v1","events":[{"kind":2}]
        }}), 13).unwrap();
        evidence.finish().unwrap();
        let lines = std::fs::read_to_string(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        let rows: Vec<Value> = lines.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["source_tick"], 12);
        assert_eq!(rows[0]["events"][0]["kind"], 2);
    }
}

impl Evidence {
    pub fn new(path: &Path) -> Result<Self, Box<dyn Error>> {
        Ok(Self { output: BufWriter::new(File::options().write(true).create_new(true).open(path)?),
            bytes: 0, ended: false })
    }

    pub fn observe(&mut self, tick: &Value, ordinal: usize) -> Result<(), Box<dyn Error>> {
        let frame = &tick["gameplay"];
        if frame["schema"] != "halospawns.h1GameplaySource.v1" {
            return Err("missing gameplay evidence".into());
        }
        let events = frame["events"].as_array().ok_or("missing gameplay events")?;
        if events.len() > 2048 { return Err("gameplay frame exceeds budget".into()); }
        if !events.is_empty() && !self.ended {
            let mut line = serde_json::to_vec(&json!({"source_tick":ordinal,"events":events}))?;
            line.push(b'\n');
            self.bytes += line.len();
            if self.bytes > 128 * 1024 * 1024 { return Err("gameplay evidence exceeds budget".into()); }
            self.output.write_all(&line)?;
        }
        self.ended |= tick["game_ended_this_tick"].as_bool() == Some(true);
        Ok(())
    }

    pub fn finish(mut self) -> Result<(), Box<dyn Error>> {
        self.output.flush()?;
        Ok(())
    }
}
