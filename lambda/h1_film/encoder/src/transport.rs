use serde_json::{Map, Number, Value};
use std::error::Error;
use std::io::Read;
use std::sync::Arc;

pub const MAX_FRAME: usize = 4 * 1024 * 1024;
type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[cfg(test)]
#[path = "transport_pose_tests.rs"]
mod pose_tests;

pub struct ObjectRecord {
    wire: Box<[u8]>,
    expansion: usize,
    source: Value,
    object_type: u64,
    packed: bool,
}

impl ObjectRecord {
    pub fn source(&self) -> &Value {
        &self.source
    }

    pub fn object_type(&self) -> u64 {
        self.object_type
    }
}

#[derive(Default)]
pub struct ObjectState {
    records: Vec<Arc<ObjectRecord>>,
    pub decoded: u64,
    pub reused: u64,
}

impl ObjectState {
    pub fn records(&self) -> &[Arc<ObjectRecord>] {
        &self.records
    }

    pub fn materialize(&self) -> Value {
        Value::Array(
            self.records
                .iter()
                .map(|record| record.source.clone())
                .collect(),
        )
    }
}

pub struct PoseState {
    poses: [h1_pose_codec::pose::Pose; 4],
    active: [bool; 4],
    rigs: Vec<h1_pose_codec::pose::Skeleton>,
    pub decoded: u64,
    pub nodes_decoded: u64,
}

impl Default for PoseState {
    fn default() -> Self {
        Self {
            poses: std::array::from_fn(|_| Vec::new()),
            active: [false; 4],
            rigs: h1_pose_codec::skeletons(),
            decoded: 0,
            nodes_decoded: 0,
        }
    }
}

impl PoseState {
    pub fn slices(&self) -> [Option<&[h1_pose_codec::pose::Node]>; 4] {
        std::array::from_fn(|slot| self.active[slot].then_some(self.poses[slot].as_slice()))
    }

    pub fn materialize(&self, source: &mut Value) -> Result<()> {
        for (slot, pose) in self.slices().into_iter().enumerate() {
            if let Some(pose) = pose {
                let target = source
                    .get_mut("players")
                    .and_then(Value::as_array_mut)
                    .and_then(|players| players.get_mut(slot))
                    .and_then(|player| player.get_mut("model_nodes"))
                    .ok_or("missing typed pose placeholder")?;
                *target = serde_json::to_value(pose)?;
            }
        }
        Ok(())
    }
}

const OBJECT_FIELDS: &[&str] = &[
    "object_id",
    "object_type",
    "tag_name",
    "x",
    "y",
    "z",
    "forward_x",
    "forward_y",
    "forward_z",
    "up_x",
    "up_y",
    "up_z",
    "parent_ref",
    "owner_object_ref",
];
const SPAWN_FIELDS: &[&str] = &["spawn_index", "x", "y", "z", "facing", "team", "gametypes"];

struct Cursor<'a>(&'a [u8], bool, usize);
impl<'a> Cursor<'a> {
    fn take(&mut self, size: usize) -> Result<&'a [u8]> {
        if size > self.0.len() {
            return Err("truncated engine record".into());
        }
        let (value, rest) = self.0.split_at(size);
        self.0 = rest;
        Ok(value)
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into()?))
    }
    fn text(&mut self) -> Result<String> {
        Ok(self.text_ref()?.to_owned())
    }
    fn text_ref(&mut self) -> Result<&'a str> {
        let length = self.u32()? as usize;
        if length > 65536 {
            return Err("engine string exceeds limit".into());
        }
        Ok(std::str::from_utf8(self.take(length)?)?)
    }
    fn float(&mut self) -> Result<Value> {
        let value = f32::from_le_bytes(self.take(4)?.try_into()?) as f64;
        Ok(Value::Number(
            Number::from_f64(value).ok_or("non-finite engine value")?,
        ))
    }
    fn packed(&mut self, tag: u8, target: &mut Value, depth: usize) -> Result<()> {
        self.2 += match tag {
            10 => 170,
            11 => 80,
            _ => 17,
        };
        if self.2 > MAX_FRAME {
            return Err("expanded engine frame exceeds limit".into());
        }
        if !self.1 || depth + if tag == 11 { 2 } else { 1 } >= 32 {
            return Err("unsupported or overnested packed engine record".into());
        }
        if tag == 12 {
            if !target.is_array() {
                *target = Value::Array(Vec::new());
            }
            let values = target.as_array_mut().unwrap();
            values.resize_with(13, || Value::Null);
            for value in values {
                *value = self.float()?;
            }
            return Ok(());
        }
        let fields = if tag == 10 {
            OBJECT_FIELDS
        } else {
            SPAWN_FIELDS
        };
        if !target.as_object().is_some_and(|values| {
            values.len() == fields.len()
                && values.keys().map(String::as_str).eq(fields.iter().copied())
        }) {
            *target = Value::Object(
                fields
                    .iter()
                    .map(|key| ((*key).into(), Value::Null))
                    .collect(),
            );
        }
        for (index, value) in target.as_object_mut().unwrap().values_mut().enumerate() {
            if tag == 10 {
                match index {
                    0 => *value = Value::from(self.u32()?),
                    1 => *value = Value::from(self.u32()? as i32),
                    2 => {
                        let text = self.text_ref()?;
                        if let Value::String(previous) = value {
                            if previous != text {
                                previous.clear();
                                previous.push_str(text);
                            }
                        } else {
                            *value = Value::String(text.to_owned());
                        }
                    }
                    3..=11 => *value = self.float()?,
                    _ => {
                        let reference = self.u32()?;
                        *value = if reference == u32::MAX {
                            Value::from(-1)
                        } else {
                            Value::from(reference)
                        };
                    }
                }
            } else {
                match index {
                    0 | 5 => *value = Value::from(self.u32()? as i32),
                    1..=4 => *value = self.float()?,
                    _ => {
                        if !value.is_array() {
                            *value = Value::Array(Vec::new());
                        }
                        let values = value.as_array_mut().unwrap();
                        values.resize_with(4, || Value::Null);
                        for value in values {
                            *value = Value::from(self.u32()? as i32);
                        }
                    }
                }
            }
        }
        Ok(())
    }
    #[inline]
    fn scalar(&mut self, tag: u8) -> Result<Value> {
        self.take(1)?;
        Ok(match tag {
            0 => Value::Null,
            1 => Value::Bool(false),
            2 => Value::Bool(true),
            3 => Value::from(i32::from_le_bytes(self.take(4)?.try_into()?)),
            4 => Value::from(self.u32()?),
            5 | 6 => {
                let number = if tag == 5 {
                    f32::from_le_bytes(self.take(4)?.try_into()?) as f64
                } else {
                    f64::from_le_bytes(self.take(8)?.try_into()?)
                };
                Value::Number(Number::from_f64(number).ok_or("non-finite engine value")?)
            }
            _ => return Err("not a scalar engine tag".into()),
        })
    }
    fn value(&mut self, depth: usize) -> Result<Value> {
        if depth >= 32 {
            return Err("engine record exceeds nesting limit".into());
        }
        let tag = self.take(1)?[0];
        Ok(match tag {
            0 => Value::Null,
            1 => Value::Bool(false),
            2 => Value::Bool(true),
            3 => Value::from(i32::from_le_bytes(self.take(4)?.try_into()?)),
            4 => Value::from(self.u32()?),
            5 | 6 => {
                let number = if tag == 5 {
                    f32::from_le_bytes(self.take(4)?.try_into()?) as f64
                } else {
                    f64::from_le_bytes(self.take(8)?.try_into()?)
                };
                Value::Number(Number::from_f64(number).ok_or("non-finite engine value")?)
            }
            7 => Value::String(self.text()?),
            8 | 9 => {
                let count = self.u32()? as usize;
                if count > 65536 || count > self.0.len() / if tag == 9 { 5 } else { 1 } {
                    return Err("invalid engine collection length".into());
                }
                if tag == 8 {
                    let mut values = Vec::with_capacity(count);
                    for _ in 0..count {
                        values.push(self.value(depth + 1)?);
                    }
                    Value::Array(values)
                } else {
                    let mut values = Map::with_capacity(count);
                    for _ in 0..count {
                        let key = self.text()?;
                        if values.insert(key, self.value(depth + 1)?).is_some() {
                            return Err("duplicate engine object key".into());
                        }
                    }
                    Value::Object(values)
                }
            }
            10..=12 => {
                let mut value = Value::Null;
                self.packed(tag, &mut value, depth)?;
                value
            }
            _ => return Err("unknown engine transport tag".into()),
        })
    }

    fn reuse(&mut self, target: &mut Value, depth: usize) -> Result<()> {
        if depth >= 32 {
            return Err("engine record exceeds nesting limit".into());
        }
        let tag = *self.0.first().ok_or("truncated engine record")?;
        if (10..=12).contains(&tag) {
            self.take(1)?;
            return self.packed(tag, target, depth);
        }
        if tag == 7
            && let Value::String(text) = target
        {
            self.take(1)?;
            let next = self.text_ref()?;
            if text != next {
                text.clear();
                text.push_str(next);
            }
            return Ok(());
        }
        if tag == 8
            && let Value::Array(values) = target
        {
            self.take(1)?;
            let count = self.u32()? as usize;
            if count > 65536 || count > self.0.len() {
                return Err("invalid engine collection length".into());
            }
            values.resize_with(count, || Value::Null);
            for value in values {
                if let Some(&tag @ 0..=6) = self.0.first() {
                    if depth + 1 >= 32 {
                        return Err("engine record exceeds nesting limit".into());
                    }
                    *value = self.scalar(tag)?;
                } else {
                    self.reuse(value, depth + 1)?;
                }
            }
            return Ok(());
        }
        if tag == 9
            && let Value::Object(values) = target
        {
            self.take(1)?;
            let count = self.u32()? as usize;
            if count > 65536 || count > self.0.len() / 5 {
                return Err("invalid engine collection length".into());
            }
            let start = (self.0, self.2);
            if values.len() == count {
                let mut matched = true;
                for (key, value) in values.iter_mut() {
                    if self.text_ref()? != key {
                        matched = false;
                        break;
                    }
                    self.reuse(value, depth + 1)?;
                }
                if matched {
                    // Matching a unique existing key sequence also proves that
                    // this record has no duplicate keys, without a second set.
                    return Ok(());
                }
                (self.0, self.2) = start;
            }
            let mut old = std::mem::take(values);
            *values = Map::with_capacity(count);
            for _ in 0..count {
                let key = self.text_ref()?;
                let (key, mut value) = old
                    .swap_remove_entry(key)
                    .unwrap_or_else(|| (key.to_owned(), Value::Null));
                self.reuse(&mut value, depth + 1)?;
                if values.insert(key, value).is_some() {
                    return Err("duplicate engine object key".into());
                }
            }
            return Ok(());
        }
        *target = self.value(depth)?;
        Ok(())
    }

    fn objects(&mut self, state: &mut ObjectState) -> Result<()> {
        if self.take(1)?[0] != 8 {
            return Err("missing objects".into());
        }
        let count = self.u32()? as usize;
        if count > 65536 || count > self.0.len() {
            return Err("invalid engine collection length".into());
        }
        for index in 0..count {
            if let Some(previous) = state.records.get(index)
                && previous.packed == self.1
                && self.0.starts_with(&previous.wire)
            {
                self.take(previous.wire.len())?;
                self.2 += previous.expansion;
                if self.2 > MAX_FRAME {
                    return Err("expanded engine frame exceeds limit".into());
                }
                state.reused += 1;
                continue;
            }
            let start = self.0;
            let expansion = self.2;
            let source = self.value(2)?;
            let object_type = source
                .get("object_type")
                .and_then(Value::as_u64)
                .ok_or("invalid object type")?;
            let record = Arc::new(ObjectRecord {
                wire: start[..start.len() - self.0.len()].into(),
                expansion: self.2 - expansion,
                source,
                object_type,
                packed: self.1,
            });
            if let Some(previous) = state.records.get_mut(index) {
                *previous = record;
            } else {
                state.records.push(record);
            }
            state.decoded += 1;
        }
        state.records.truncate(count);
        Ok(())
    }

    fn pose(&mut self, target: &mut h1_pose_codec::pose::Pose) -> Result<bool> {
        if !self.1 || self.0.len() < 5 || self.0[0] != 8 {
            return Ok(false);
        }
        let count = u32::from_le_bytes(self.0[1..5].try_into()?) as usize;
        if !(1..=256).contains(&count)
            || self.0.len() < 5 + count * 53
            || (0..count).any(|index| self.0[5 + index * 53] != 12)
        {
            return Ok(false);
        }
        self.2 += count * 17;
        if self.2 > MAX_FRAME {
            return Err("expanded engine frame exceeds limit".into());
        }
        self.take(5)?;
        target.resize(count, [0.; 13]);
        for node in target {
            self.take(1)?;
            for component in node {
                *component = f32::from_le_bytes(self.take(4)?.try_into()?) as f64;
                if !component.is_finite() {
                    return Err("non-finite engine value".into());
                }
            }
        }
        Ok(true)
    }

    fn player_field(
        &mut self,
        key: &str,
        value: &mut Value,
        pose: &mut h1_pose_codec::pose::Pose,
        active: &mut bool,
    ) -> Result<()> {
        if key == "model_nodes" {
            *active = self.pose(pose)?;
            if *active {
                if let Value::Array(nodes) = value {
                    nodes.clear();
                } else {
                    *value = Value::Array(Vec::new());
                }
                return Ok(());
            }
        }
        self.reuse(value, 3)
    }

    fn player(
        &mut self,
        target: &mut Value,
        pose: &mut h1_pose_codec::pose::Pose,
        active: &mut bool,
    ) -> Result<()> {
        if self.0.first() != Some(&9) {
            return self.reuse(target, 2);
        }
        self.take(1)?;
        let count = self.u32()? as usize;
        if count > 65536 || count > self.0.len() / 5 {
            return Err("invalid engine collection length".into());
        }
        let start = (self.0, self.2);
        if let Some(values) = target.as_object_mut()
            && values.len() == count
        {
            let mut matched = true;
            for (key, value) in values.iter_mut() {
                if self.text_ref()? != key {
                    matched = false;
                    break;
                }
                self.player_field(key, value, pose, active)?;
            }
            if matched {
                return Ok(());
            }
            (self.0, self.2) = start;
            *active = false;
        }
        let mut previous = target.take();
        let mut output = Map::with_capacity(count);
        for _ in 0..count {
            let key = self.text_ref()?;
            let (key, mut value) = previous
                .as_object_mut()
                .and_then(|previous| previous.swap_remove_entry(key))
                .unwrap_or_else(|| (key.to_owned(), Value::Null));
            self.player_field(&key, &mut value, pose, active)?;
            if output.insert(key, value).is_some() {
                return Err("duplicate engine object key".into());
            }
        }
        *target = Value::Object(output);
        Ok(())
    }

    fn players(&mut self, target: &mut Value, state: &mut PoseState) -> Result<()> {
        if self.0.len() < 5 || self.0[0] != 8 {
            return self.reuse(target, 1);
        }
        let count = u32::from_le_bytes(self.0[1..5].try_into()?) as usize;
        if count > 4 {
            return self.reuse(target, 1);
        }
        self.take(5)?;
        if !target.is_array() {
            *target = Value::Array(Vec::new());
        }
        let players = target.as_array_mut().unwrap();
        players.resize_with(count, || Value::Null);
        for (slot, player) in players.iter_mut().enumerate() {
            self.player(player, &mut state.poses[slot], &mut state.active[slot])?;
            if state.active[slot] {
                let tag = player["player_object_data"]["tag_name"].as_str();
                if state.rigs.iter().any(|rig| {
                    Some(rig.tag.as_str()) == tag && rig.parents.len() == state.poses[slot].len()
                }) {
                    state.decoded += 1;
                    state.nodes_decoded += state.poses[slot].len() as u64;
                } else {
                    player["model_nodes"] = serde_json::to_value(&state.poses[slot])?;
                    state.active[slot] = false;
                }
            }
        }
        Ok(())
    }

    fn incremental_root(
        &mut self,
        target: &mut Value,
        state: &mut ObjectState,
        mut poses: Option<&mut PoseState>,
    ) -> Result<()> {
        if self.take(1)?[0] != 9 {
            return Err("invalid engine frame root".into());
        }
        let count = self.u32()? as usize;
        if count > 65536 || count > self.0.len() / 5 {
            return Err("invalid engine collection length".into());
        }
        let mut previous = target.take();
        let mut output = Map::with_capacity(count);
        let mut found_objects = false;
        for _ in 0..count {
            let key = self.text_ref()?;
            let (key, mut value) = previous
                .as_object_mut()
                .and_then(|previous| previous.swap_remove_entry(key))
                .unwrap_or_else(|| (key.to_owned(), Value::Null));
            if key == "objects" {
                self.objects(state)?;
                value = Value::Array(Vec::new());
                found_objects = true;
            } else if key == "players" && poses.is_some() {
                self.players(&mut value, poses.as_deref_mut().unwrap())?;
            } else {
                self.reuse(&mut value, 1)?;
            }
            if output.insert(key, value).is_some() {
                return Err("duplicate engine object key".into());
            }
        }
        if !found_objects {
            return Err("missing objects".into());
        }
        *target = Value::Object(output);
        Ok(())
    }
}

pub struct Stream<R> {
    input: R,
    buffer: Vec<u8>,
    pub bytes: u64,
    packed: bool,
    pub objects: ObjectState,
    pub poses: PoseState,
}
impl<R: Read> Stream<R> {
    pub fn new(input: R) -> Result<Self> {
        Self::with_contract(input, "HSFT0001")
    }
    pub fn with_contract(mut input: R, contract: &str) -> Result<Self> {
        if !matches!(contract, "HSFT0001" | "HSFT0002") {
            return Err("unsupported engine transport contract".into());
        }
        let mut magic = [0; 8];
        input.read_exact(&mut magic)?;
        if magic != contract.as_bytes() {
            return Err("not an H1 binary tick stream".into());
        }
        Ok(Self {
            input,
            buffer: Vec::new(),
            bytes: 8,
            packed: contract == "HSFT0002",
            objects: ObjectState::default(),
            poses: PoseState::default(),
        })
    }
    pub fn next(&mut self) -> Result<Option<Value>> {
        self.next_reusing(Value::Null)
    }
    pub fn next_reusing(&mut self, mut value: Value) -> Result<Option<Value>> {
        if !self.read_frame()? {
            return Ok(None);
        }
        let mut cursor = Cursor(&self.buffer, self.packed, self.buffer.len());
        cursor.reuse(&mut value, 0)?;
        if !cursor.0.is_empty() || !value.is_object() {
            return Err("invalid engine frame root or trailing data".into());
        }
        Ok(Some(value))
    }

    pub fn next_incremental(&mut self, value: Value) -> Result<Option<Value>> {
        self.next_incremental_with_poses(value, false)
    }

    pub fn next_incremental_with_poses(
        &mut self,
        mut value: Value,
        typed_poses: bool,
    ) -> Result<Option<Value>> {
        if !self.read_frame()? {
            return Ok(None);
        }
        self.poses.active.fill(false);
        let mut cursor = Cursor(&self.buffer, self.packed, self.buffer.len());
        cursor.incremental_root(
            &mut value,
            &mut self.objects,
            typed_poses.then_some(&mut self.poses),
        )?;
        if !cursor.0.is_empty() {
            return Err("invalid engine frame root or trailing data".into());
        }
        Ok(Some(value))
    }

    pub fn verify_incremental_source(&self, value: &Value) -> Result<()> {
        let expected = Cursor(&self.buffer, self.packed, self.buffer.len()).value(0)?;
        let mut actual = value.clone();
        actual["objects"] = self.objects.materialize();
        self.poses.materialize(&mut actual)?;
        if serde_json::to_vec(&actual)? != serde_json::to_vec(&expected)? {
            return Err("incremental state differs from complete generic source".into());
        }
        Ok(())
    }

    fn read_frame(&mut self) -> Result<bool> {
        let mut length = [0; 4];
        if self.input.read(&mut length[..1])? == 0 {
            return Ok(false);
        }
        self.input.read_exact(&mut length[1..])?;
        let size = u32::from_le_bytes(length) as usize;
        if !(5..=MAX_FRAME).contains(&size) {
            return Err("invalid engine frame length".into());
        }
        self.buffer.resize(size, 0);
        self.input.read_exact(&mut self.buffer)?;
        self.bytes += 4 + size as u64;
        Ok(true)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn stream(ticks: &[Value]) -> Vec<u8> {
        let mut stream = b"HSFT0002".to_vec();
        for tick in ticks {
            let mut frame = Vec::new();
            encode(tick, &mut frame);
            stream.extend_from_slice(&(frame.len() as u32).to_le_bytes());
            stream.extend_from_slice(&frame);
        }
        stream
    }

    #[test]
    fn incremental_records_preserve_full_source_across_lifecycle_and_wire_changes() {
        let first = serde_json::json!({"object_id":0x80000001u32,"object_type":2,"tag_name":"\u{e9}","x":-0.0,"ignored":{"value":[1,2]}});
        let second = serde_json::json!({"object_id":2,"object_type":0,"x":1.0});
        let mut changed = first.clone();
        changed["object_id"] = Value::from(0x80010001u32);
        changed["x"] = Value::from(0.0);
        let mut reordered = changed.clone();
        reordered.as_object_mut().unwrap().sort_keys();
        let objects = vec![
            vec![first.clone(), second.clone()],
            vec![first.clone(), second.clone()],
            vec![second.clone(), first.clone()],
            vec![second.clone()],
            vec![],
            vec![changed.clone()],
            vec![changed.clone()],
            vec![reordered],
            vec![first],
        ];
        let ticks: Vec<_> = objects.into_iter().enumerate().map(|(index, objects)|
            serde_json::json!({"current_tick":index,"objects":objects,"unknown":{"nested":[1,null,false]}})).collect();
        let bytes = stream(&ticks);
        let mut reference = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let mut incremental = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let mut spare = Value::Null;
        let mut retained = None;
        for index in 0..ticks.len() {
            let expected = reference.next().unwrap().unwrap();
            let mut actual = incremental.next_incremental(spare).unwrap().unwrap();
            incremental.verify_incremental_source(&actual).unwrap();
            let mut corrupt = actual.clone();
            corrupt["unknown"] = Value::Null;
            assert!(incremental.verify_incremental_source(&corrupt).is_err());
            assert!(actual["objects"].as_array().unwrap().is_empty());
            if index == 0 {
                retained = Some(incremental.objects.records()[0].clone());
            }
            if index == 1 {
                assert!(Arc::ptr_eq(
                    retained.as_ref().unwrap(),
                    &incremental.objects.records()[0]
                ));
            }
            if index == 5 {
                assert!(!Arc::ptr_eq(
                    retained.as_ref().unwrap(),
                    &incremental.objects.records()[0]
                ));
            }
            actual["objects"] = incremental.objects.materialize();
            assert_eq!(
                serde_json::to_vec(&actual).unwrap(),
                serde_json::to_vec(&expected).unwrap()
            );
            actual["objects"] = serde_json::json!([]);
            spare = actual;
        }
        assert!(incremental.objects.reused >= 3);
        assert_eq!(
            retained.unwrap().source()["x"].as_f64().unwrap().to_bits(),
            (-0.0f64).to_bits()
        );
        assert!(incremental.next_incremental(spare).unwrap().is_none());
    }

    #[test]
    fn cached_records_still_enforce_expanded_budget_and_truncation() {
        let mut packed = vec![10];
        packed.extend_from_slice(&1u32.to_le_bytes());
        packed.extend_from_slice(&2u32.to_le_bytes());
        packed.extend_from_slice(&0u32.to_le_bytes());
        packed.extend_from_slice(&[0; 36]);
        packed.extend_from_slice(&[255; 8]);
        let mut array = vec![8, 1, 0, 0, 0];
        array.extend_from_slice(&packed);
        let mut state = ObjectState::default();
        Cursor(&array, true, array.len())
            .objects(&mut state)
            .unwrap();
        let record = state.records()[0].clone();
        let mut cursor = Cursor(&array, true, MAX_FRAME - 170);
        cursor.objects(&mut state).unwrap();
        assert_eq!(cursor.2, MAX_FRAME);
        assert!(Arc::ptr_eq(&record, &state.records()[0]));
        assert!(
            Cursor(&array, false, array.len())
                .objects(&mut state)
                .is_err()
        );
        assert!(
            Cursor(&array, true, MAX_FRAME - 169)
                .objects(&mut state)
                .is_err()
        );
        for length in 0..array.len() {
            assert!(
                Cursor(&array[..length], true, length)
                    .objects(&mut state)
                    .is_err()
            );
        }
        for invalid in [f32::INFINITY, f32::NEG_INFINITY, f32::NAN] {
            let mut changed = array.clone();
            changed[18..22].copy_from_slice(&invalid.to_le_bytes());
            assert!(
                Cursor(&changed, true, changed.len())
                    .objects(&mut state)
                    .is_err()
            );
        }
    }

    #[test]
    fn incremental_root_rejects_missing_duplicate_and_invalid_records() {
        for tick in [
            serde_json::json!({}),
            serde_json::json!({"objects":null}),
            serde_json::json!({"objects":[{"object_type":-1}]}),
            serde_json::json!({"objects":[{"object_type":"2"}]}),
            serde_json::json!({"objects":[null]}),
        ] {
            let bytes = stream(&[tick]);
            assert!(
                Stream::with_contract(&bytes[..], "HSFT0002")
                    .unwrap()
                    .next_incremental(Value::Null)
                    .is_err()
            );
        }
        let mut frame = vec![9, 2, 0, 0, 0];
        for _ in 0..2 {
            frame.extend_from_slice(&7u32.to_le_bytes());
            frame.extend_from_slice(b"objects");
            frame.extend_from_slice(&[8, 0, 0, 0, 0]);
        }
        assert!(
            Cursor(&frame, true, frame.len())
                .incremental_root(&mut Value::Null, &mut ObjectState::default(), None)
                .is_err()
        );
    }

    #[test]
    fn packed_expansion_budget_is_restored_when_recycled_object_shape_changes() {
        let mut bytes = vec![9, 2, 0, 0, 0, 6, 0, 0, 0];
        bytes.extend_from_slice(b"matrix");
        bytes.push(12);
        bytes.extend_from_slice(&[0; 13 * 4]);
        bytes.extend_from_slice(&[4, 0, 0, 0]);
        bytes.extend_from_slice(b"next");
        bytes.push(0);
        let mut recycled = serde_json::json!({"matrix":[],"previous":null});
        let mut cursor = Cursor(&bytes, true, MAX_FRAME - 17);
        cursor.reuse(&mut recycled, 0).unwrap();
        assert_eq!(cursor.2, MAX_FRAME);
        assert!(cursor.0.is_empty());
        assert_eq!(recycled["matrix"].as_array().unwrap().len(), 13);
        assert!(recycled.get("next").is_some());
        assert!(recycled.get("previous").is_none());
        assert!(Cursor(&bytes, true, MAX_FRAME - 16).value(0).is_err());
    }

    #[test]
    fn packed_records_preserve_fields_bits_and_recycled_shapes() {
        let mut object = vec![10];
        object.extend_from_slice(&0x80000001u32.to_le_bytes());
        object.extend_from_slice(&(-3i32).to_le_bytes());
        object.extend_from_slice(&2u32.to_le_bytes());
        object.extend_from_slice("é".as_bytes());
        let coordinates = [-0.0f32, 1.25, -2.5, 1.0, 0.0, -0.0, 0.0, 0.0, 1.0];
        for number in coordinates {
            object.extend_from_slice(&number.to_le_bytes());
        }
        object.extend_from_slice(&u32::MAX.to_le_bytes());
        object.extend_from_slice(&0x80000002u32.to_le_bytes());
        let mut invalid_text = object.clone();
        invalid_text[13] = 0xff;
        assert!(
            Cursor(&invalid_text, true, invalid_text.len())
                .value(0)
                .is_err()
        );
        let expected_object = serde_json::json!({"object_id":2147483649u32, "object_type":-3,
            "tag_name":"é", "x":-0.0,"y":1.25,"z":-2.5,"forward_x":1.0,"forward_y":0.0,
            "forward_z":-0.0,"up_x":0.0,"up_y":0.0,"up_z":1.0,"parent_ref":-1,"owner_object_ref":2147483650u32});
        let mut spawn = vec![11];
        spawn.extend_from_slice(&7i32.to_le_bytes());
        for number in [-0.0f32, 2.5, 3.0, -1.5] {
            spawn.extend_from_slice(&number.to_le_bytes());
        }
        for number in [-1i32, 0, 1, -1, 32767] {
            spawn.extend_from_slice(&number.to_le_bytes());
        }
        let expected_spawn = serde_json::json!({"spawn_index":7,"x":-0.0,"y":2.5,"z":3.0,
            "facing":-1.5,"team":-1,"gametypes":[0,1,-1,32767]});
        let mut matrix = vec![12];
        let components: Vec<f32> = (0..13)
            .map(|index| if index == 0 { -0.0 } else { index as f32 / 8.0 })
            .collect();
        for number in &components {
            matrix.extend_from_slice(&number.to_le_bytes());
        }
        let expected_matrix = serde_json::to_value(&components).unwrap();
        for (bytes, expected) in [
            (object, expected_object),
            (spawn, expected_spawn),
            (matrix, expected_matrix),
        ] {
            for mut target in [
                Value::Null,
                expected.clone(),
                serde_json::json!({"wrong":[]} ),
                serde_json::json!([false]),
            ] {
                let mut cursor = Cursor(&bytes, true, bytes.len());
                cursor.reuse(&mut target, 0).unwrap();
                assert!(cursor.0.is_empty());
                assert_eq!(
                    serde_json::to_vec(&target).unwrap(),
                    serde_json::to_vec(&expected).unwrap()
                );
            }
            assert!(Cursor(&bytes, false, bytes.len()).value(0).is_err());
            for length in 0..bytes.len() {
                assert!(Cursor(&bytes[..length], true, length).value(0).is_err());
            }
            assert!(Cursor(&bytes, true, bytes.len()).value(31).is_err());
        }
        for invalid in [f32::INFINITY, f32::NEG_INFINITY, f32::NAN] {
            let mut matrix = vec![12];
            for number in [invalid; 13] {
                matrix.extend_from_slice(&number.to_le_bytes());
            }
            assert!(Cursor(&matrix, true, matrix.len()).value(0).is_err());
        }
        assert!(Stream::with_contract(&b"HSFT0002"[..], "HSFT0001").is_err());
        assert!(Stream::with_contract(&b"HSFT0001"[..], "HSFT0002").is_err());
        assert!(Stream::with_contract(&b"HSFT0003"[..], "HSFT0003").is_err());
    }

    fn encode(value: &Value, bytes: &mut Vec<u8>) {
        encode_with_poses(value, bytes, false);
    }

    pub fn packed_stream(ticks: &[Value]) -> Vec<u8> {
        let mut bytes = b"HSFT0002".to_vec();
        for tick in ticks {
            let mut frame = Vec::new();
            encode_with_poses(tick, &mut frame, true);
            bytes.extend_from_slice(&(frame.len() as u32).to_le_bytes());
            bytes.extend_from_slice(&frame);
        }
        bytes
    }

    fn encode_with_poses(value: &Value, bytes: &mut Vec<u8>, packed: bool) {
        fn text(value: &str, bytes: &mut Vec<u8>) {
            bytes.extend_from_slice(&(value.len() as u32).to_le_bytes());
            bytes.extend_from_slice(value.as_bytes());
        }
        match value {
            Value::Null => bytes.push(0),
            Value::Bool(value) => bytes.push(if *value { 2 } else { 1 }),
            Value::Number(value) if value.is_f64() => {
                bytes.push(6);
                bytes.extend_from_slice(&value.as_f64().unwrap().to_le_bytes());
            }
            Value::Number(value) => {
                if let Some(value) = value.as_u64() {
                    bytes.push(4);
                    bytes.extend_from_slice(&u32::try_from(value).unwrap().to_le_bytes());
                } else {
                    bytes.push(3);
                    bytes.extend_from_slice(
                        &i32::try_from(value.as_i64().unwrap())
                            .unwrap()
                            .to_le_bytes(),
                    );
                }
            }
            Value::String(value) => {
                bytes.push(7);
                text(value, bytes);
            }
            Value::Array(values)
                if packed && values.len() == 13 && values.iter().all(Value::is_number) =>
            {
                bytes.push(12);
                for value in values {
                    bytes.extend_from_slice(&(value.as_f64().unwrap() as f32).to_le_bytes());
                }
            }
            Value::Array(values) => {
                bytes.push(8);
                bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
                for value in values {
                    encode_with_poses(value, bytes, packed);
                }
            }
            Value::Object(values) => {
                bytes.push(9);
                bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
                for (key, value) in values {
                    text(key, bytes);
                    encode_with_poses(value, bytes, packed);
                }
            }
        }
    }

    #[test]
    fn reused_storage_preserves_values_order_and_floating_point_bits() {
        let cases = [
            r#"{"a":[{"x":-0.0,"y":"same"},1],"b":{"c":true},"removed":null}"#,
            r#"{"a":[{"x":1.5,"y":"same"},2],"b":{"c":false},"removed":[]}"#,
            r#"{"a":[{"y":"changed","x":-0.0},null,3],"b":4,"added":true}"#,
            r#"{"b":[null],"a":[],"added":{"nested":"\u00e9"}}"#,
            r#"{"b":{"nested":0.0},"a":["value"],"added":null}"#,
            r#"{}"#,
        ];
        let mut reused = Value::Null;
        for case in cases.into_iter().cycle().take(36) {
            let mut bytes = Vec::new();
            encode(&serde_json::from_str(case).unwrap(), &mut bytes);
            let fresh = Cursor(&bytes, false, bytes.len()).value(0).unwrap();
            let mut cursor = Cursor(&bytes, false, bytes.len());
            cursor.reuse(&mut reused, 0).unwrap();
            assert!(cursor.0.is_empty());
            assert_eq!(
                serde_json::to_vec(&reused).unwrap(),
                serde_json::to_vec(&fresh).unwrap()
            );
            // Projection may remove fields or change key order before recycling.
            if let Some(values) = reused.as_object_mut() {
                values.swap_remove("removed");
            }
        }
    }

    #[test]
    fn reused_storage_keeps_all_transport_rejection_gates() {
        let mut too_deep = vec![8, 1, 0, 0, 0].repeat(33);
        too_deep.push(0);
        let invalid = [
            vec![99],
            vec![8, 255, 255, 255, 255],
            vec![7, 255, 255, 255, 255],
            vec![7, 1, 0, 0, 0, 255],
            vec![5, 0, 0, 128, 127],
            vec![9, 1, 0, 0, 0],
            vec![9, 2, 0, 0, 0, 1, 0, 0, 0, b'a', 0, 1, 0, 0, 0, b'a', 0],
            too_deep,
        ];
        for bytes in invalid {
            assert!(Cursor(&bytes, false, bytes.len()).value(0).is_err());
            for mut target in [
                Value::Null,
                serde_json::json!("old"),
                serde_json::json!([1]),
                serde_json::json!({"a": 1, "b": 2}),
            ] {
                assert!(
                    Cursor(&bytes, false, bytes.len())
                        .reuse(&mut target, 0)
                        .is_err()
                );
            }
        }
        for frame in [vec![8, 0, 0, 0, 0], vec![9, 0, 0, 0, 0, 0]] {
            let mut stream = b"HSFT0001".to_vec();
            stream.extend_from_slice(&(frame.len() as u32).to_le_bytes());
            stream.extend_from_slice(&frame);
            assert!(
                Stream::new(&stream[..])
                    .unwrap()
                    .next_reusing(serde_json::json!({}))
                    .is_err()
            );
        }
    }

    #[test]
    fn scalar_array_fast_path_matches_reference_and_rejects_truncation() {
        let mut scalars = vec![0, 1, 2, 3];
        scalars.extend_from_slice(&i32::MIN.to_le_bytes());
        scalars.push(4);
        scalars.extend_from_slice(&u32::MAX.to_le_bytes());
        scalars.push(5);
        scalars.extend_from_slice(&(-0.0f32).to_le_bytes());
        scalars.push(6);
        scalars.extend_from_slice(&f64::MAX.to_le_bytes());
        let mut bytes = vec![8, 7, 0, 0, 0];
        bytes.extend_from_slice(&scalars);
        for depth in [0, 30] {
            let expected = Cursor(&bytes, false, bytes.len()).value(depth).unwrap();
            let mut target = serde_json::json!([{"old": 1}]);
            let mut cursor = Cursor(&bytes, false, bytes.len());
            cursor.reuse(&mut target, depth).unwrap();
            assert!(cursor.0.is_empty());
            assert_eq!(
                serde_json::to_vec(&target).unwrap(),
                serde_json::to_vec(&expected).unwrap()
            );
        }
        let mut target = serde_json::json!([1]);
        assert!(
            Cursor(&bytes, false, bytes.len())
                .reuse(&mut target, 31)
                .is_err()
        );
        for length in 0..bytes.len() {
            let mut target = serde_json::json!([1]);
            assert!(
                Cursor(&bytes[..length], false, length)
                    .reuse(&mut target, 0)
                    .is_err()
            );
        }
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut bytes = vec![8, 1, 0, 0, 0, 6];
            bytes.extend_from_slice(&value.to_le_bytes());
            let mut target = serde_json::json!([1]);
            assert!(
                Cursor(&bytes, false, bytes.len())
                    .reuse(&mut target, 0)
                    .is_err()
            );
        }
    }

    #[test]
    fn floats_handles_and_utf8_are_exact() {
        let mut raw = vec![9, 3, 0, 0, 0];
        raw.extend_from_slice(&[1, 0, 0, 0, b'x', 5]);
        raw.extend_from_slice(&(-0.0_f32).to_le_bytes());
        raw.extend_from_slice(&[1, 0, 0, 0, b'h', 4]);
        raw.extend_from_slice(&0xfedc0001_u32.to_le_bytes());
        raw.extend_from_slice(&[1, 0, 0, 0, b'n', 7, 2, 0, 0, 0, 0xc3, 0xa9]);
        let value = Cursor(&raw, false, raw.len()).value(0).unwrap();
        assert_eq!(value["x"].as_f64().unwrap().to_bits(), (-0.0_f64).to_bits());
        assert_eq!(value["h"], 0xfedc0001_u32);
        assert_eq!(value["n"], "\u{e9}");
    }
    #[test]
    fn bad_values_and_allocations_are_rejected() {
        for input in [
            &[99][..],
            &[8, 255, 255, 255, 255],
            &[7, 255, 255, 255, 255],
            &[5, 0, 0, 128, 127],
            &[9, 1, 0, 0, 0],
        ] {
            assert!(Cursor(input, false, input.len()).value(0).is_err());
        }
    }
    #[test]
    fn truncated_frames_are_rejected() {
        let raw = b"HSFT0001\x08\0\0\0\x09\0\0\0\0";
        assert!(Stream::new(&raw[..]).unwrap().next().is_err());
        assert!(Stream::new(&b"HSFT0001\x08"[..]).unwrap().next().is_err());
    }
}
