// Included beside the lossless host-world delta reader. Window masks are assigned
// retrospectively. Frames leave the buffer only after every possible anchor is known.
const CONDITIONS: [&str; 11] = [
    "teammate",
    "camo",
    "overshield",
    "rockets",
    "only-camo",
    "only-overshield",
    "only-camo-overshield",
    "only-rockets",
    "only-camo-rockets",
    "only-overshield-rockets",
    "only-camo-overshield-rockets",
];

#[derive(serde::Deserialize)]
struct EquipmentPad {
    position: [f64; 3],
    types: [i32; 4],
    period: i64,
    // Resolved tag path -> 1 camo, 2 overshield, 4 rockets, 0 other permutation.
    tags: std::collections::BTreeMap<String, usize>,
}

impl EquipmentPad {
    fn active(&self, mode: i32) -> bool {
        mode > 0
            && self.types.iter().any(|&t| {
                t == mode
                    || t == 12
                    || (t == 13 && mode != 1)
                    || (t == 14 && mode != 1 && mode != 5)
            })
    }
}

#[derive(serde::Deserialize)]
struct SituationConfig {
    pads: Option<Vec<EquipmentPad>>,
    births: Option<Vec<[i64; 3]>>,
    stride: i64,
}

struct WindowFrame {
    index: u32,
    points: [Option<crate::Point>; crate::SLOTS],
    subjects: [u16; 11],
}

#[derive(Default)]
struct WindowLayer {
    cells: std::collections::BTreeMap<(usize, [i32; 3]), u64>,
    paths: crate::movement_paths::Paths,
    last: [Option<crate::Point>; crate::SLOTS],
}

impl WindowLayer {
    fn frame(&mut self, frame: &WindowFrame, mask: u16, rate: u32) {
        for (slot, p) in frame.points.iter().enumerate() {
            let current = p.filter(|_| mask & (1 << slot) != 0);
            if let Some(point) = current {
                let cell = point.position.map(|v| (v * 2.).floor() as i32);
                *self.cells.entry((slot, cell)).or_default() += u64::from(120 / rate);
            }
            if let (Some(a), Some(b)) = (self.last[slot], current) {
                let distance = (0..3)
                    .map(|i| (a.position[i] - b.position[i]).powi(2))
                    .sum::<f64>()
                    .sqrt();
                if a.identity == b.identity
                    && (0.035..=crate::MAX_SPEED).contains(&(distance * f64::from(rate)))
                {
                    self.paths
                        .segment(slot, a.position, b.position, frame.index, rate, distance);
                } else {
                    self.paths.stop(slot);
                }
            } else if self.last[slot].is_some() {
                self.paths.stop(slot);
            }
            self.last[slot] = current;
        }
    }
    fn stop(&mut self) {
        for slot in 0..crate::SLOTS {
            self.paths.stop(slot);
        }
        self.last.fill(None);
    }
}

pub(super) struct Situations {
    pads: Option<Vec<EquipmentPad>>,
    births: Option<std::collections::BTreeSet<(i64, usize, i64)>>,
    stride: i64,
    rate: u32,
    clock: Option<i64>,
    last_life: [Option<i64>; crate::SLOTS],
    dead: [bool; crate::SLOTS],
    frames: std::collections::VecDeque<WindowFrame>,
    layers: std::collections::BTreeMap<usize, WindowLayer>,
    events: Vec<(i64, &'static str, u16)>,
    uncertain: usize,
    partial: bool,
}

fn tick_list<'a>(object: &'a DecodedValue, key: &str) -> &'a [DecodedValue] {
    object
        .as_object()
        .and_then(|o| o.get(key))
        .and_then(DecodedValue::as_array)
        .unwrap_or_default()
}

impl Situations {
    pub(super) fn new(config: impl std::io::Read, rate: u32) -> crate::Result<Self> {
        let cfg: SituationConfig = serde_json::from_reader(config)?;
        if !matches!(cfg.stride, 1 | 4)
            || cfg.pads.as_ref().is_some_and(|p| {
                p.len() > 4096
                    || p.iter().any(|pad| {
                        pad.period <= 0
                            || pad.period > 65535
                            || pad.tags.values().any(|code| !matches!(code, 0 | 1 | 2 | 4))
                    })
            })
        {
            return Err("invalid situation inputs".into());
        }
        let partial = cfg.pads.is_none() || cfg.stride != 1;
        Ok(Self {
            pads: cfg.pads,
            births: cfg.births.map(|events| {
                events
                    .into_iter()
                    .map(|[t, s, h]| (t, s as usize, h))
                    .collect()
            }),
            stride: cfg.stride,
            rate,
            clock: None,
            last_life: [None; crate::SLOTS],
            dead: [false; crate::SLOTS],
            frames: Default::default(),
            layers: Default::default(),
            events: Vec::new(),
            uncertain: 0,
            partial,
        })
    }

    fn emit(&mut self) {
        if let Some(frame) = self.frames.pop_front() {
            for (k, layer) in &mut self.layers {
                layer.frame(&frame, frame.subjects[*k], self.rate);
            }
        }
    }

    fn anchor(&mut self, clock: i64, condition: usize, subjects: u16) {
        if subjects == 0 {
            return;
        }
        if self.frames.len() != 5 * self.rate as usize {
            self.partial = true;
            return;
        }
        self.layers.entry(condition).or_default();
        self.events.push((clock, CONDITIONS[condition], subjects));
        for frame in &mut self.frames {
            frame.subjects[condition] |= subjects;
        }
    }

    fn items(&mut self, tick: &DecodedValue, prev: &DecodedValue, clock: i64, subjects: u16) {
        if clock <= 0 || clock % i64::from(self.rate) != 0 {
            return;
        }
        let mode = tick
            .as_object()
            .and_then(|v| v.get("game_meta"))
            .and_then(|v| movement_number(v, "game_type"))
            .or_else(|| movement_number(tick, "game_type"))
            .unwrap_or(0.) as i32;
        if mode == 0 {
            self.partial = true;
            return;
        }
        let Some(pads) = self.pads.as_ref() else {
            return;
        };
        let due: Vec<_> = pads
            .iter()
            .filter(|p| p.active(mode) && clock % (p.period * i64::from(self.rate)) == 0)
            .collect();
        if due.is_empty() {
            return;
        }
        // A launcher released by a player keeps its original handle.
        let mut prior = std::collections::HashSet::new();
        for o in tick_list(prev, "objects") {
            if let Some(id) = movement_number(o, "object_id") {
                prior.insert(id as i64);
            }
        }
        for p in tick_list(prev, "players") {
            if let Some(body) = p.as_object().and_then(|o| o.get("player_object_data")) {
                for w in tick_list(body, "weapons") {
                    if let Some(id) = movement_number(w, "object_id") {
                        prior.insert(id as i64);
                    }
                }
            }
        }
        let (mut observed, mut uncertain) = (0usize, 0usize);
        for pad in due {
            let mut draws = Vec::new();
            for o in tick_list(tick, "objects") {
                let Some(DecodedValue::String(tag)) = o.as_object().and_then(|o| o.get("tag_name"))
                else {
                    continue;
                };
                let Some(&code) = pad.tags.get(tag.as_ref()) else {
                    continue;
                };
                if !movement_number(o, "object_id").is_some_and(|v| !prior.contains(&(v as i64)))
                    || movement_number(o, "parent_ref") != Some(-1.)
                    || movement_number(o, "owner_object_ref").is_some_and(|v| v != -1.)
                {
                    continue;
                }
                let squared = ["x", "y", "z"]
                    .iter()
                    .enumerate()
                    .map(|(i, k)| {
                        (movement_number(o, k).unwrap_or(f64::INFINITY) - pad.position[i]).powi(2)
                    })
                    .sum::<f64>();
                if squared <= 0.35f64.powi(2) {
                    draws.push(code);
                }
            }
            if draws.len() == 1 {
                observed |= draws[0];
            } else {
                uncertain |= pad.tags.values().fold(0, |mask, code| mask | code);
            }
        }
        for (index, bit) in [1, 2, 4].into_iter().enumerate() {
            if observed & bit != 0 {
                self.anchor(clock, 1 + index, subjects);
            }
        }
        if uncertain & !observed != 0 || self.stride != 1 {
            self.partial = true;
            self.uncertain += 1;
        } else if observed != 0 {
            self.anchor(clock, 3 + observed, subjects);
        }
    }

    fn observe(
        &mut self,
        tick: &DecodedValue,
        previous: Option<&DecodedValue>,
        index: usize,
        clock: Option<f64>,
    ) -> crate::Result<()> {
        let clock = clock
            .filter(|v| v.is_finite() && v.fract() == 0.)
            .map(|v| v as i64);
        let contiguous = self
            .clock
            .zip(clock)
            .is_some_and(|(a, b)| a.checked_add(1) == Some(b));
        if !contiguous {
            if self.clock.is_some() {
                self.partial = true;
            }
            while !self.frames.is_empty() {
                self.emit();
            }
            for l in self.layers.values_mut() {
                l.stop();
            }
            self.last_life.fill(None);
            self.dead.fill(false);
        }
        self.clock = clock;
        let Some(clock) = clock else {
            self.partial = true;
            return Ok(());
        };
        let mut points = movement_points(tick);
        let mut teams = [None; crate::SLOTS];
        let mut spawned = Vec::new();
        for p in tick_list(tick, "players") {
            let Some(s) = movement_number(p, "player_index")
                .map(|v| v as usize)
                .filter(|&v| v < crate::SLOTS)
            else {
                continue;
            };
            teams[s] = movement_number(p, "team").and_then(|v| u8::try_from(v as i64).ok());
            if movement_number(p, "respawn_timer").is_some_and(|v| v > 0.) {
                points[s] = None;
            }
            if let Some(body) = points[s] {
                if self.dead[s] && self.last_life[s].is_some_and(|h| h != body.identity) {
                    let verified = self.births.as_ref().is_none_or(|events| {
                        (0..self.stride).any(|delta| {
                            events.contains(&(
                                (index as i64) * self.stride - delta,
                                s,
                                body.identity,
                            ))
                        })
                    });
                    if verified {
                        spawned.push(s);
                    } else {
                        self.partial = true;
                    }
                }
                self.last_life[s] = Some(body.identity);
                self.dead[s] = false;
            } else if movement_number(p, "object_ref")
                .is_some_and(|id| id == -1. || id == 4294967295.)
                || movement_number(p, "respawn_timer").is_some_and(|v| v > 0.)
                || p.as_object()
                    .and_then(|o| o.get("player_object_data"))
                    .and_then(|v| movement_number(v, "health"))
                    .is_some_and(|h| h <= 0.)
            {
                self.dead[s] = true;
            }
        }
        let mut roster = 0u16;
        for (s, team) in teams.iter().enumerate() {
            if team.is_some() {
                roster |= 1 << s;
            } else {
                self.last_life[s] = None;
                self.dead[s] = false;
            }
        }
        for s in spawned {
            if let Some(team) = teams[s] {
                let subjects = (0..crate::SLOTS)
                    .filter(|&i| i != s && teams[i] == Some(team))
                    .fold(0, |mask, i| mask | (1 << i));
                self.anchor(clock, 0, subjects);
            }
        }
        if contiguous && let Some(prev) = previous {
            self.items(tick, prev, clock, roster);
        }
        if self.frames.len() >= 5 * self.rate as usize {
            self.emit();
        }
        self.frames.push_back(WindowFrame {
            index: index as u32,
            points,
            subjects: [0; 11],
        });
        Ok(())
    }

    pub(super) fn write(mut self, output: impl std::io::Write) -> crate::Result<()> {
        while !self.frames.is_empty() {
            self.emit();
        }
        let mut products = std::collections::BTreeMap::new();
        for (key, layer) in self.layers {
            let mut presence = std::collections::BTreeMap::<usize, Vec<[i64; 4]>>::new();
            for ((slot, [x, y, z]), t) in layer.cells {
                presence
                    .entry(slot)
                    .or_default()
                    .push([x.into(), y.into(), z.into(), t as i64]);
            }
            products.insert(
                CONDITIONS[key],
                serde_json::json!({"presence":presence,"paths":layer.paths.finish()}),
            );
        }
        serde_json::to_writer(
            output,
            &serde_json::json!({"events":self.events,"products":products,
            "uncertain_cycles":self.uncertain,"partial":self.partial}),
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod situation_tests {
    use super::*;
    use serde_json::json;

    fn host_tick(t: u32, rate: u32) -> DecodedValue {
        let dying = t + 1 == 8 * rate || t + 1 == 10 * rate;
        let life = 20 + u32::from(t >= 8 * rate) + u32::from(t >= 10 * rate);
        let player = |slot, team, handle, x, respawn| {
            json!({
                "player_index":slot, "team":team, "object_ref":handle, "respawn_timer":respawn,
                "player_object_data":{"x":x,"y":0,"z":0,"health":1}
            })
        };
        let item = |name, handle, x| {
            json!({"tag_name":name,"object_id":handle,
            "parent_ref":-1,"owner_object_ref":-1,"x":x,"y":0,"z":0})
        };
        let mut objects = Vec::new();
        if t == 6 * rate || t == 12 * rate {
            objects.push(item("shield", t, 1));
            objects.push(item("launcher", 500, 3));
        } else if t + 1 == 12 * rate {
            // This handle was already in the world before the second cycle.
            objects.push(item("launcher", 500, 5));
        }
        let tick = json!({"game_type":2,"objects":objects,"players":[
            player(0,0,10,f64::from(t)/f64::from(rate),0),
            player(1,0,life,2.,u32::from(dying)), player(2,1,30,4.,0)]});
        let mut writer = BinaryWriter::new();
        write_value(&mut writer, &tick).unwrap();
        read_value(&mut BinaryReader::new(&writer.bytes), 1).unwrap()
    }

    #[test]
    fn overlapping_lives_half_open_presence_and_verified_item_sets_at_both_rates() {
        for rate in [30, 120] {
            let config = json!({"births": [[8*rate,1,21],[10*rate,1,22]],"stride":1,"pads":[
                {"position":[1,0,0],"period":6,"types":[2,0,0,0],"tags":{"shield":2}},
                {"position":[3,0,0],"period":6,"types":[2,0,0,0],"tags":{"launcher":4}},
            ]})
            .to_string();
            let mut windows = Situations::new(config.as_bytes(), rate).unwrap();
            let mut previous = None;
            for t in 0..=12 * rate {
                let frame = host_tick(t, rate);
                windows
                    .observe(&frame, previous.as_ref(), t as usize, Some(f64::from(t)))
                    .unwrap();
                previous = Some(frame);
            }
            let mut json = Vec::new();
            windows.write(&mut json).unwrap();
            let result: Value = serde_json::from_slice(&json).unwrap();
            let events = result["events"].as_array().unwrap();
            assert!(events.contains(&json!([8 * rate, "teammate", 1])));
            assert!(events.contains(&json!([10 * rate, "teammate", 1])));
            assert!(events.contains(&json!([6 * rate, "only-overshield-rockets", 7])));
            assert!(events.contains(&json!([12 * rate, "overshield", 7])));
            assert_eq!(events.len(), 6);
            assert_eq!(result["uncertain_cycles"], 1);
            let team = &result["products"]["teammate"];
            assert_eq!(team["presence"].as_object().unwrap().len(), 1);
            let cells = team["presence"]["0"].as_array().unwrap();
            assert_eq!(cells.first().unwrap()[0], 6); // x = 3.0
            assert_eq!(cells.last().unwrap()[0], 19); // x < 10.0
            assert_eq!(
                cells.iter().map(|c| c[3].as_u64().unwrap()).sum::<u64>(),
                7 * 120
            );
            let routes = team["paths"]["0"].as_array().unwrap();
            assert_eq!(
                routes
                    .iter()
                    .map(|r| r["ticks"].as_u64().unwrap())
                    .sum::<u64>(),
                7 * 120 - u64::from(120 / rate)
            );
            let cycle = &result["products"]["only-overshield-rockets"];
            assert_eq!(cycle["presence"]["2"][0][3], 5 * 120);
            assert!(cycle["paths"]["2"].is_null());
        }
    }
}
