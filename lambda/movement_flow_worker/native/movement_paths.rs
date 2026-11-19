//! Preserve the geometry and time of consecutive visits through a neighborhood.
use super::{SCALE, SLOTS};
use serde::Serialize;
use std::io::Write;

const POSITION_SCALE: f64 = 512.;
const TOLERANCE: f64 = 1. / 128.;
const CORE_DISTANCE: f64 = 4.;
const CORE_TIME: u32 = 360;
const HISTORY_TIME: u32 = 120;

#[derive(Clone, Copy)]
struct Sample {
    pos: [f64; 3],
    frame: u32,
    time: u32,
    distance: f64,
}

#[derive(Serialize)]
struct Route {
    key: [i32; 6],
    start_frame: u32,
    ticks: u32,
    distance: u32,
    lead: u32,
    // Absolute quantized first position, then time and coordinate deltas.
    geometry: Vec<i32>,
}

#[derive(Default)]
struct Track {
    points: Vec<Sample>,
    core: usize,
    routes: Vec<Route>,
}

fn heading(a: [f64; 3], b: [f64; 3]) -> i32 {
    let [dx, dy, dz] = std::array::from_fn(|k| b[k] - a[k]);
    if dy.abs() > 1.5 * dx.hypot(dz) {
        if dy > 0. { 16 } else { 17 }
    } else {
        (dz.atan2(dx) * 8. / std::f64::consts::PI).round() as i32 & 15
    }
}

// Subdivide until playback stays within the error budget at every original tick.
// Both paths are linear between original ticks, so the same bound holds there.
fn simplify(points: &[Sample], keep: &mut [bool], begin: usize, end: usize) {
    if begin >= end {
        return;
    }
    keep[begin] = true;
    keep[end] = true;
    let mut stack = vec![(begin, end)];
    while let Some((a, b)) = stack.pop() {
        let start = points[a];
        let finish = points[b];
        let mut worst = TOLERANCE * TOLERANCE;
        let mut split = None;
        for (i, p) in points.iter().enumerate().take(b).skip(a + 1) {
            let fraction = f64::from(p.time - start.time) / f64::from(finish.time - start.time);
            let mut error = 0.;
            for axis in 0..3 {
                let v = start.pos[axis] + fraction * (finish.pos[axis] - start.pos[axis]);
                error += (v - p.pos[axis]).powi(2);
            }
            if error > worst {
                worst = error;
                split = Some(i);
            }
        }
        if let Some(i) = split {
            keep[i] = true;
            stack.push((a, i));
            stack.push((i, b));
        }
    }
}

impl Track {
    fn segment(&mut self, a: [f64; 3], b: [f64; 3], frame: u32, dt: u32, distance: f64) {
        if self.points.is_empty() {
            self.points.push(Sample {
                pos: a,
                frame: frame - 1,
                time: 0,
                distance: 0.,
            });
        }
        let prev = *self.points.last().unwrap();
        let next = Sample {
            pos: b,
            frame,
            time: prev.time + dt,
            distance: prev.distance + distance,
        };
        self.points.push(next);
        let start = self.points[self.core];
        if next.distance - start.distance >= CORE_DISTANCE || next.time - start.time >= CORE_TIME {
            self.emit();
            // Carry one second of witnessed approach for the next stroke's tail.
            let from = self
                .points
                .partition_point(|p| p.time + HISTORY_TIME < next.time);
            self.points.drain(..from);
            self.core = self.points.len() - 1;
        }
    }
    fn stop(&mut self) {
        self.emit();
        self.points.clear();
        self.core = 0;
    }
    fn emit(&mut self) {
        let n = self.points.len();
        if n < self.core + 2 {
            return;
        }
        let first = self.points[self.core];
        let last = self.points[n - 1];
        let length = last.distance - first.distance;
        let core = &self.points[self.core..];
        let along = |fraction: f64| {
            let target = first.distance + length * fraction;
            let i = core
                .partition_point(|p| p.distance < target)
                .clamp(1, core.len() - 1);
            let (a, b) = (core[i - 1], core[i]);
            let mix = (target - a.distance) / (b.distance - a.distance);
            std::array::from_fn(|k| a.pos[k] + mix * (b.pos[k] - a.pos[k]))
        };
        let mid = along(0.5);
        let into = heading(first.pos, along(0.35));
        let out = heading(along(0.65), last.pos);
        let band = if length < 0.2 {
            0
        } else if length < 1.0 {
            1
        } else {
            2
        };
        let key = [
            (mid[0] * 2.).floor() as i32,
            (mid[1] * 4.).floor() as i32,
            (mid[2] * 2.).floor() as i32,
            into,
            out,
            band,
        ];
        let mut keep = vec![false; n];
        simplify(&self.points, &mut keep, 0, self.core);
        simplify(&self.points, &mut keep, self.core, n - 1);
        let mut geometry = Vec::new();
        let mut last_pos = [0; 3];
        let mut last_time = 0;
        for (i, p) in self.points.iter().enumerate().filter(|(i, _)| keep[*i]) {
            let pos = p.pos.map(|v| (v * POSITION_SCALE).round() as i32);
            if i != 0 {
                geometry.push((p.time - last_time) as i32);
            }
            geometry.extend((0..3).map(|k| pos[k] - last_pos[k]));
            last_pos = pos;
            last_time = p.time;
        }
        self.routes.push(Route {
            key,
            start_frame: self.points[0].frame,
            ticks: last.time - first.time,
            distance: (length * SCALE).round().max(1.) as u32,
            lead: first.time - self.points[0].time,
            geometry,
        });
    }
}

#[derive(Default)]
pub(super) struct Paths {
    tracks: [Track; SLOTS],
}

impl Paths {
    pub(super) fn segment(
        &mut self,
        slot: usize,
        a: [f64; 3],
        b: [f64; 3],
        frame: u32,
        rate: u32,
        distance: f64,
    ) {
        self.tracks[slot].segment(a, b, frame, 120 / rate, distance);
    }
    pub(super) fn stop(&mut self, slot: usize) {
        self.tracks[slot].stop();
    }
    pub(super) fn write(mut self, mut output: impl Write) -> super::Result<()> {
        let mut groups = std::collections::BTreeMap::new();
        for (slot, track) in self.tracks.iter_mut().enumerate() {
            track.stop();
            if !track.routes.is_empty() {
                groups.insert(slot, &track.routes);
            }
        }
        serde_json::to_writer(&mut output, &groups)?;
        output.flush()?;
        Ok(())
    }
}
