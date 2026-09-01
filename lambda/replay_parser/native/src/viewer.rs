use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::error::Error;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const VIEWER_SCHEMA: &str = "halospawns.viewerReplay.v1";
const VIEWER_PROFILE: &str = "frontend-default";
const VIEWER_PROFILE_REVISION: u32 = 1;
const VIEWER_PROJECTION_SHA256: &str =
    "573da0d397c796d686354b7269094409984304961f8c55ab03bb2e46180d21ec";
const PARTS_SCHEMA: &str = "halospawns.viewerReplayDeltaParts.v1";
const CHUNK_MAGIC: &[u8; 4] = b"HSRD";
const CHUNK_VERSION: u8 = 1;
const KEYFRAME_INTERVAL: usize = 2048;
const MAX_TICKS: usize = 432_000;
const MAX_JSON_DEPTH: usize = 32;
const MAX_STRING_CHARACTERS: usize = 64 * 1024 * 1024;
const SAFE_INTEGER_MAX: f64 = 9_007_199_254_740_991.0;

const VALUE_NULL: u8 = 0;
const VALUE_FALSE: u8 = 1;
const VALUE_TRUE: u8 = 2;
const VALUE_INTEGER: u8 = 3;
const VALUE_FLOAT32: u8 = 4;
const VALUE_FLOAT64: u8 = 5;
const VALUE_STRING: u8 = 6;
const VALUE_ARRAY: u8 = 7;
const VALUE_OBJECT: u8 = 8;

const DELTA_SAME: u8 = 0;
const DELTA_REPLACE: u8 = 1;
const DELTA_OBJECT: u8 = 2;
const DELTA_ARRAY: u8 = 3;
const DELTA_NUMBER_XOR: u8 = 4;
const DELTA_FLOAT32_XOR: u8 = 5;
const DELTA_INTEGER_DIFFERENCE: u8 = 6;
const DELTA_DENSE_ARRAY: u8 = 7;
const DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY: u8 = 8;
const DELTA_FLOAT32_DIFFERENCE: u8 = 9;
const DELTA_DENSE_FLOAT32_XOR_ARRAY: u8 = 10;
const DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY: u8 = 11;
const DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY: u8 = 12;
const DELTA_FLOAT32_BIT_PREDICTION: u8 = 13;
const DELTA_FLOAT32_VALUE_PREDICTION: u8 = 14;
const DELTA_DENSE_FLOAT32_BITPACKED_ARRAY: u8 = 15;

const FLOAT32_MODE_XOR: u8 = 0;
const FLOAT32_MODE_DIFFERENCE: u8 = 1;
const FLOAT32_MODE_BIT_PREDICTION: u8 = 2;
const FLOAT32_MODE_VALUE_PREDICTION: u8 = 3;

static WRITER: OnceLock<Mutex<Option<ViewerWriter>>> = OnceLock::new();

#[derive(Debug)]
struct Projection {
    definitions: Map<String, Value>,
    limits: Map<String, Value>,
    root_fields: Map<String, Value>,
}

impl Projection {
    fn load() -> Result<Self, Box<dyn Error>> {
        let document: Value = serde_json::from_str(include_str!(
            "../../contracts/replays/frontend-default.v1.projection.json"
        ))?;
        let object = document
            .as_object()
            .ok_or("viewer projection must be an object")?;
        if object.get("schema").and_then(Value::as_str) != Some(VIEWER_SCHEMA)
            || object.get("profile").and_then(Value::as_str) != Some(VIEWER_PROFILE)
            || object.get("profile_revision").and_then(Value::as_u64)
                != Some(VIEWER_PROFILE_REVISION.into())
        {
            return Err("viewer projection identity does not match the pinned contract".into());
        }
        let definitions = object
            .get("definitions")
            .and_then(Value::as_object)
            .ok_or("viewer projection definitions are missing")?
            .clone();
        let limits = object
            .get("limits")
            .and_then(Value::as_object)
            .ok_or("viewer projection limits are missing")?
            .clone();
        let root_fields = object
            .get("root")
            .and_then(Value::as_object)
            .and_then(|root| root.get("fields"))
            .and_then(Value::as_object)
            .ok_or("viewer projection root fields are missing")?
            .clone();
        Ok(Self {
            definitions,
            limits,
            root_fields,
        })
    }

    fn resolve<'a>(&'a self, mut node: &'a Value) -> Result<&'a Value, Box<dyn Error>> {
        let mut depth = 0;
        while node.get("kind").and_then(Value::as_str) == Some("ref") {
            let name = node
                .get("name")
                .and_then(Value::as_str)
                .ok_or("viewer projection reference has no name")?;
            node = self
                .definitions
                .get(name)
                .ok_or("viewer projection reference is unknown")?;
            depth += 1;
            if depth > 32 {
                return Err("viewer projection reference cycle".into());
            }
        }
        Ok(node)
    }

    fn limit(&self, node: &Map<String, Value>) -> Result<usize, Box<dyn Error>> {
        let raw = node
            .get("take_first")
            .or_else(|| node.get("max_items"))
            .or_else(|| node.get("limit"))
            .ok_or("viewer projection collection has no limit")?;
        let value = if let Some(name) = raw.as_str() {
            self.limits
                .get(name)
                .and_then(Value::as_u64)
                .ok_or("viewer projection named limit is invalid")?
        } else {
            raw.as_u64().ok_or("viewer projection limit is invalid")?
        };
        usize::try_from(value).map_err(Into::into)
    }

    fn project(&self, node: &Value, source: &Value) -> Result<Value, Box<dyn Error>> {
        let node = self.resolve(node)?;
        if node.as_str() == Some("scalar") {
            return project_scalar(source, false);
        }
        if node.as_str() == Some("nullable_scalar") {
            return project_scalar(source, true);
        }
        let specification = node
            .as_object()
            .ok_or("viewer projection node is malformed")?;
        match specification.get("kind").and_then(Value::as_str) {
            Some("object") => {
                let source = source
                    .as_object()
                    .ok_or("viewer projection expected an object")?;
                let fields = specification
                    .get("fields")
                    .and_then(Value::as_object)
                    .ok_or("viewer projection object fields are malformed")?;
                if let Some(required) = specification.get("required").and_then(Value::as_array) {
                    for required_key in required {
                        let required_key = required_key
                            .as_str()
                            .ok_or("viewer projection required field is malformed")?;
                        if source.get(required_key).is_none_or(Value::is_null) {
                            return Err(
                                "viewer projection is missing a required object field".into()
                            );
                        }
                    }
                }
                let mut output = Map::new();
                for (output_key, child) in fields {
                    if child.get("kind").and_then(Value::as_str) == Some("generated") {
                        continue;
                    }
                    let source_key = child
                        .get("source")
                        .and_then(Value::as_str)
                        .unwrap_or(output_key);
                    let Some(value) = source.get(source_key).filter(|value| !value.is_null())
                    else {
                        continue;
                    };
                    output.insert(output_key.clone(), self.project(child, value)?);
                }
                Ok(Value::Object(output))
            }
            Some("map") => {
                let source = source
                    .as_object()
                    .ok_or("viewer projection expected a dynamic object map")?;
                if source.len() > self.limit(specification)? {
                    return Err("viewer projection map exceeds its pinned limit".into());
                }
                let values = specification
                    .get("values")
                    .ok_or("viewer projection map values are missing")?;
                let mut output = Map::new();
                for (key, value) in source {
                    if !value.is_null() {
                        output.insert(key.clone(), self.project(values, value)?);
                    }
                }
                Ok(Value::Object(output))
            }
            Some("array") => {
                let source = source
                    .as_array()
                    .ok_or("viewer projection expected an array")?;
                let limit = self.limit(specification)?;
                if !specification.contains_key("take_first") && source.len() > limit {
                    return Err("viewer projection array exceeds its pinned limit".into());
                }
                let items = specification
                    .get("items")
                    .ok_or("viewer projection array items are missing")?;
                source
                    .iter()
                    .take(limit)
                    .map(|value| self.project(items, value))
                    .collect::<Result<Vec<_>, _>>()
                    .map(Value::Array)
            }
            _ => Err("viewer projection node kind is unsupported".into()),
        }
    }
}

fn project_scalar(source: &Value, nullable: bool) -> Result<Value, Box<dyn Error>> {
    if source.is_null() {
        return if nullable {
            Ok(Value::Null)
        } else {
            Err("viewer projection expected a non-null scalar".into())
        };
    }
    if source.is_array() || source.is_object() {
        return Err("viewer projection expected a JSON scalar".into());
    }
    if source.as_f64().is_some_and(|value| !value.is_finite()) {
        return Err("viewer projection rejects non-finite numbers".into());
    }
    Ok(source.clone())
}

#[derive(Debug)]
struct BinaryWriter {
    bytes: Vec<u8>,
    strings: HashMap<String, usize>,
}

impl BinaryWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(1024 * 1024),
            strings: HashMap::new(),
        }
    }

    fn byte(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn bytes(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }

    fn varuint(&mut self, value: u64) -> Result<(), Box<dyn Error>> {
        if value > 9_007_199_254_740_991 {
            return Err("viewer delta integer exceeds the safe range".into());
        }
        let mut remaining = value;
        while remaining >= 128 {
            self.byte(((remaining % 128) + 128) as u8);
            remaining /= 128;
        }
        self.byte(remaining as u8);
        Ok(())
    }

    fn string(&mut self, value: &str) -> Result<(), Box<dyn Error>> {
        if let Some(index) = self.strings.get(value).copied() {
            return self.varuint((index * 2) as u64);
        }
        self.varuint((value.len() * 2 + 1) as u64)?;
        self.bytes(value.as_bytes());
        self.strings.insert(value.to_owned(), self.strings.len());
        Ok(())
    }
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64()
}

fn negative_zero(value: f64) -> bool {
    value == 0.0 && value.is_sign_negative()
}

fn exact_f32(value: f64) -> bool {
    let rounded = value as f32 as f64;
    rounded.to_bits() == value.to_bits()
}

fn same_scalar(left: &Value, right: &Value) -> bool {
    match (number(left), number(right)) {
        (Some(left), Some(right)) => left.to_bits() == right.to_bits(),
        _ => left == right,
    }
}

fn delta_same(previous: Option<&Value>, next: &Value) -> bool {
    let Some(previous) = previous else {
        return false;
    };
    match (previous, next) {
        (Value::Array(previous), Value::Array(next)) => {
            previous.len() == next.len()
                && previous
                    .iter()
                    .zip(next)
                    .all(|(left, right)| delta_same(Some(left), right))
        }
        (Value::Object(previous), Value::Object(next)) => {
            previous.len() == next.len()
                && previous.iter().all(|(key, value)| {
                    next.get(key)
                        .is_some_and(|next_value| delta_same(Some(value), next_value))
                })
        }
        _ => same_scalar(previous, next),
    }
}

fn write_number(writer: &mut BinaryWriter, value: f64) -> Result<(), Box<dyn Error>> {
    if !value.is_finite() {
        return Err("viewer delta numbers must be finite".into());
    }
    if value.fract() == 0.0 && value.abs() <= SAFE_INTEGER_MAX && !negative_zero(value) {
        let integer = value as i64;
        writer.byte(VALUE_INTEGER);
        writer.byte(u8::from(integer < 0));
        writer.varuint(integer.unsigned_abs())?;
    } else if exact_f32(value) && !negative_zero(value) {
        writer.byte(VALUE_FLOAT32);
        writer.bytes(&(value as f32).to_le_bytes());
    } else {
        writer.byte(VALUE_FLOAT64);
        writer.bytes(&value.to_le_bytes());
    }
    Ok(())
}

fn validate_json_safety(value: &Value, depth: usize) -> Result<(), Box<dyn Error>> {
    if depth > MAX_JSON_DEPTH {
        return Err("viewer source exceeds the pinned maximum JSON depth".into());
    }
    match value {
        Value::String(value)
            if value.len() > MAX_STRING_CHARACTERS
                && value.chars().count() > MAX_STRING_CHARACTERS =>
        {
            Err("viewer source string exceeds the pinned character limit".into())
        }
        Value::Array(values) => {
            for value in values {
                validate_json_safety(value, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            for value in values.values() {
                validate_json_safety(value, depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn write_value(writer: &mut BinaryWriter, value: &Value) -> Result<(), Box<dyn Error>> {
    match value {
        Value::Null => writer.byte(VALUE_NULL),
        Value::Bool(false) => writer.byte(VALUE_FALSE),
        Value::Bool(true) => writer.byte(VALUE_TRUE),
        Value::Number(_) => write_number(writer, number(value).ok_or("invalid JSON number")?)?,
        Value::String(value) => {
            writer.byte(VALUE_STRING);
            writer.string(value)?;
        }
        Value::Array(values) => {
            writer.byte(VALUE_ARRAY);
            writer.varuint(values.len() as u64)?;
            for value in values {
                write_value(writer, value)?;
            }
        }
        Value::Object(values) => {
            writer.byte(VALUE_OBJECT);
            writer.varuint(values.len() as u64)?;
            for (key, value) in values {
                writer.string(key)?;
                write_value(writer, value)?;
            }
        }
    }
    Ok(())
}

fn varuint_length(value: u64) -> usize {
    ((64 - value.leading_zeros() as usize).max(1) + 6) / 7
}

fn signed_uint32_difference(previous: u32, next: u32) -> i64 {
    let mut difference = i64::from(next) - i64::from(previous);
    if difference > 0x7fff_ffff {
        difference -= 0x1_0000_0000;
    }
    if difference < -0x8000_0000 {
        difference += 0x1_0000_0000;
    }
    difference
}

fn signed_difference(value: i64) -> u64 {
    if value >= 0 {
        value as u64 * 2
    } else {
        value.unsigned_abs() * 2 - 1
    }
}

fn predict_bits(before_previous: f64, previous: f64) -> u32 {
    (2_u32.wrapping_mul((previous as f32).to_bits()))
        .wrapping_sub((before_previous as f32).to_bits())
}

fn predict_value_bits(before_previous: f64, previous: f64) -> u32 {
    ((2.0 * previous - before_previous) as f32).to_bits()
}

fn write_number_xor(
    writer: &mut BinaryWriter,
    previous: f64,
    next: f64,
) -> Result<(), Box<dyn Error>> {
    let xor = previous.to_bits() ^ next.to_bits();
    if xor == 0 {
        return Err("viewer number XOR delta is empty".into());
    }
    let trailing_bytes = (xor.trailing_zeros() / 8).min(7) as usize;
    let significant = xor >> (trailing_bytes * 8);
    let significant_bytes = ((64 - significant.leading_zeros() as usize) + 7) / 8;
    writer.byte(((trailing_bytes << 4) | (significant_bytes - 1)) as u8);
    writer.bytes(&significant.to_le_bytes()[..significant_bytes]);
    Ok(())
}

fn write_number_delta(
    writer: &mut BinaryWriter,
    previous: f64,
    next: f64,
    before_previous: Option<f64>,
) -> Result<(), Box<dyn Error>> {
    let difference = next - previous;
    if previous.fract() == 0.0
        && next.fract() == 0.0
        && previous.abs() <= SAFE_INTEGER_MAX
        && next.abs() <= SAFE_INTEGER_MAX
        && !negative_zero(previous)
        && !negative_zero(next)
        && difference.fract() == 0.0
        && difference.abs() <= (SAFE_INTEGER_MAX / 2.0).floor()
    {
        writer.byte(DELTA_INTEGER_DIFFERENCE);
        writer.varuint(signed_difference(difference as i64))?;
        return Ok(());
    }
    if exact_f32(previous) && exact_f32(next) {
        let previous_bits = (previous as f32).to_bits();
        let next_bits = (next as f32).to_bits();
        let mut candidates = vec![
            (DELTA_FLOAT32_XOR, u64::from(previous_bits ^ next_bits)),
            (
                DELTA_FLOAT32_DIFFERENCE,
                signed_difference(signed_uint32_difference(previous_bits, next_bits)),
            ),
        ];
        if let Some(before_previous) = before_previous.filter(|value| exact_f32(*value)) {
            candidates.push((
                DELTA_FLOAT32_BIT_PREDICTION,
                signed_difference(signed_uint32_difference(
                    predict_bits(before_previous, previous),
                    next_bits,
                )),
            ));
            candidates.push((
                DELTA_FLOAT32_VALUE_PREDICTION,
                signed_difference(signed_uint32_difference(
                    predict_value_bits(before_previous, previous),
                    next_bits,
                )),
            ));
        }
        let mut selected = candidates[0];
        for candidate in candidates.into_iter().skip(1) {
            if varuint_length(candidate.1) < varuint_length(selected.1) {
                selected = candidate;
            }
        }
        writer.byte(selected.0);
        writer.varuint(selected.1)?;
        return Ok(());
    }
    writer.byte(DELTA_NUMBER_XOR);
    write_number_xor(writer, previous, next)
}

#[derive(Debug)]
struct FloatCandidate {
    kind: u8,
    mode: u8,
    bit_width: u8,
    residuals: Vec<u64>,
    bytes: usize,
}

fn float_candidate(kind: u8, mode: u8, residuals: Vec<u64>) -> FloatCandidate {
    let varint_bytes = residuals
        .iter()
        .map(|value| varuint_length(*value))
        .sum::<usize>();
    let bit_width = residuals
        .iter()
        .map(|value| 64 - value.leading_zeros() as usize)
        .max()
        .unwrap_or(0) as u8;
    let bitpacked_bytes = 2 + (usize::from(bit_width) * residuals.len()).div_ceil(8);
    if bitpacked_bytes as f64 <= varint_bytes as f64 * 0.75 {
        FloatCandidate {
            kind: DELTA_DENSE_FLOAT32_BITPACKED_ARRAY,
            mode,
            bit_width,
            residuals,
            bytes: bitpacked_bytes,
        }
    } else {
        FloatCandidate {
            kind,
            mode,
            bit_width,
            residuals,
            bytes: varint_bytes,
        }
    }
}

fn float_array(values: &[Value]) -> Option<Vec<f64>> {
    values
        .iter()
        .map(number)
        .collect::<Option<Vec<_>>>()
        .filter(|values| values.iter().all(|value| exact_f32(*value)))
}

fn write_packed(writer: &mut BinaryWriter, values: &[u64], bit_width: u8) {
    if bit_width == 0 {
        return;
    }
    let mut accumulator: u128 = 0;
    let mut accumulator_bits = 0_u8;
    for value in values {
        accumulator |= u128::from(*value) << accumulator_bits;
        accumulator_bits += bit_width;
        while accumulator_bits >= 8 {
            writer.byte((accumulator & 0xff) as u8);
            accumulator >>= 8;
            accumulator_bits -= 8;
        }
    }
    if accumulator_bits > 0 {
        writer.byte((accumulator & 0xff) as u8);
    }
}

fn write_delta(
    writer: &mut BinaryWriter,
    previous: Option<&Value>,
    next: &Value,
    before_previous: Option<&Value>,
) -> Result<(), Box<dyn Error>> {
    if delta_same(previous, next) {
        writer.byte(DELTA_SAME);
        return Ok(());
    }
    if let (Some(previous), Some(previous_number), Some(next_number)) =
        (previous, previous.and_then(number), number(next))
    {
        write_number_delta(
            writer,
            previous_number,
            next_number,
            before_previous.and_then(number),
        )?;
        let _ = previous;
        return Ok(());
    }
    if let (Some(Value::Array(previous)), Value::Array(next)) = (previous, next) {
        if previous.len() == next.len() && !next.is_empty() {
            if let (Some(previous_float), Some(next_float)) =
                (float_array(previous), float_array(next))
            {
                let mut candidates = vec![
                    float_candidate(
                        DELTA_DENSE_FLOAT32_XOR_ARRAY,
                        FLOAT32_MODE_XOR,
                        previous_float
                            .iter()
                            .zip(&next_float)
                            .map(|(left, right)| {
                                u64::from((*left as f32).to_bits() ^ (*right as f32).to_bits())
                            })
                            .collect(),
                    ),
                    float_candidate(
                        DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY,
                        FLOAT32_MODE_DIFFERENCE,
                        previous_float
                            .iter()
                            .zip(&next_float)
                            .map(|(left, right)| {
                                signed_difference(signed_uint32_difference(
                                    (*left as f32).to_bits(),
                                    (*right as f32).to_bits(),
                                ))
                            })
                            .collect(),
                    ),
                ];
                if let Some(before_float) = before_previous
                    .and_then(Value::as_array)
                    .filter(|values| values.len() == previous.len())
                    .and_then(|values| float_array(values))
                {
                    candidates.push(float_candidate(
                        DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY,
                        FLOAT32_MODE_BIT_PREDICTION,
                        before_float
                            .iter()
                            .zip(&previous_float)
                            .zip(&next_float)
                            .map(|((before, previous), next)| {
                                signed_difference(signed_uint32_difference(
                                    predict_bits(*before, *previous),
                                    (*next as f32).to_bits(),
                                ))
                            })
                            .collect(),
                    ));
                    candidates.push(float_candidate(
                        DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY,
                        FLOAT32_MODE_VALUE_PREDICTION,
                        before_float
                            .iter()
                            .zip(&previous_float)
                            .zip(&next_float)
                            .map(|((before, previous), next)| {
                                signed_difference(signed_uint32_difference(
                                    predict_value_bits(*before, *previous),
                                    (*next as f32).to_bits(),
                                ))
                            })
                            .collect(),
                    ));
                }
                let mut selected = &candidates[0];
                for candidate in candidates.iter().skip(1) {
                    if candidate.bytes < selected.bytes {
                        selected = candidate;
                    }
                }
                writer.byte(selected.kind);
                if selected.kind == DELTA_DENSE_FLOAT32_BITPACKED_ARRAY {
                    writer.byte(selected.mode);
                    writer.byte(selected.bit_width);
                    write_packed(writer, &selected.residuals, selected.bit_width);
                } else {
                    for residual in &selected.residuals {
                        writer.varuint(*residual)?;
                    }
                }
                return Ok(());
            }
        }
        let changed = next
            .iter()
            .enumerate()
            .filter(|(index, value)| !delta_same(previous.get(*index), value))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if previous.len() == next.len() && changed.len() > next.len() / 2 {
            writer.byte(DELTA_DENSE_ARRAY);
            for (index, value) in next.iter().enumerate() {
                write_delta(
                    writer,
                    previous.get(index),
                    value,
                    before_previous
                        .and_then(Value::as_array)
                        .and_then(|values| values.get(index)),
                )?;
            }
        } else {
            writer.byte(DELTA_ARRAY);
            writer.varuint(next.len() as u64)?;
            writer.varuint(changed.len() as u64)?;
            for index in changed {
                writer.varuint(index as u64)?;
                write_delta(
                    writer,
                    previous.get(index),
                    &next[index],
                    before_previous
                        .and_then(Value::as_array)
                        .and_then(|values| values.get(index)),
                )?;
            }
        }
        return Ok(());
    }
    if let (Some(Value::Object(previous)), Value::Object(next)) = (previous, next) {
        let deletions = previous
            .keys()
            .filter(|key| !next.contains_key(*key))
            .collect::<Vec<_>>();
        let changes = next
            .iter()
            .filter(|(key, value)| !delta_same(previous.get(*key), value))
            .collect::<Vec<_>>();
        writer.byte(DELTA_OBJECT);
        writer.varuint(deletions.len() as u64)?;
        for key in deletions {
            writer.string(key)?;
        }
        writer.varuint(changes.len() as u64)?;
        for (key, value) in changes {
            writer.string(key)?;
            write_delta(
                writer,
                previous.get(key),
                value,
                before_previous
                    .and_then(Value::as_object)
                    .and_then(|values| values.get(key)),
            )?;
        }
        return Ok(());
    }
    writer.byte(DELTA_REPLACE);
    write_value(writer, next)
}

fn encode_chunk(ticks: &[Value], first_tick: usize) -> Result<Vec<u8>, Box<dyn Error>> {
    if ticks.is_empty() {
        return Err("viewer delta chunk cannot be empty".into());
    }
    let mut writer = BinaryWriter::new();
    writer.bytes(CHUNK_MAGIC);
    writer.byte(CHUNK_VERSION);
    writer.varuint(first_tick as u64)?;
    writer.varuint(ticks.len() as u64)?;
    write_value(&mut writer, &ticks[0])?;
    for index in 1..ticks.len() {
        write_delta(
            &mut writer,
            Some(&ticks[index - 1]),
            &ticks[index],
            index.checked_sub(2).map(|before| &ticks[before]),
        )?;
    }
    Ok(writer.bytes)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkPart {
    index: usize,
    first_tick: usize,
    tick_count: usize,
    raw_file: String,
    raw_bytes: usize,
}

#[derive(Debug)]
struct ViewerWriter {
    directory: PathBuf,
    projection: Projection,
    started: Instant,
    encode_duration_ms: u128,
    pending: Vec<Value>,
    tick_count: usize,
    chunks: Vec<ChunkPart>,
}

impl ViewerWriter {
    fn new(directory: PathBuf) -> Result<Self, Box<dyn Error>> {
        fs::create_dir_all(&directory)?;
        Ok(Self {
            directory,
            projection: Projection::load()?,
            started: Instant::now(),
            encode_duration_ms: 0,
            pending: Vec::with_capacity(KEYFRAME_INTERVAL),
            tick_count: 0,
            chunks: Vec::new(),
        })
    }

    fn add_tick(&mut self, source: &Value) -> Result<(), Box<dyn Error>> {
        validate_json_safety(source, 3)?;
        if self.tick_count >= MAX_TICKS {
            return Err("viewer replay tick count exceeds the pinned limit".into());
        }
        let tick = self
            .projection
            .definitions
            .get("tick")
            .ok_or("viewer tick projection is missing")?;
        self.pending.push(self.projection.project(tick, source)?);
        self.tick_count += 1;
        if self.pending.len() == KEYFRAME_INTERVAL {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), Box<dyn Error>> {
        if self.pending.is_empty() {
            return Ok(());
        }
        let started = Instant::now();
        let first_tick = self.tick_count - self.pending.len();
        let encoded = encode_chunk(&self.pending, first_tick)?;
        let index = self.chunks.len();
        let raw_file = format!("chunk-{index:05}.hsrd");
        fs::write(self.directory.join(&raw_file), &encoded)?;
        self.chunks.push(ChunkPart {
            index,
            first_tick,
            tick_count: self.pending.len(),
            raw_file,
            raw_bytes: encoded.len(),
        });
        self.pending.clear();
        self.encode_duration_ms += started.elapsed().as_millis();
        Ok(())
    }

    fn finish(&mut self, source: &Map<String, Value>) -> Result<(), Box<dyn Error>> {
        for value in source.values() {
            validate_json_safety(value, 2)?;
        }
        self.flush()?;
        if self.tick_count == 0 {
            return Err("viewer artifacts require at least one replay tick".into());
        }
        let mut replay = Map::new();
        for (key, node) in &self.projection.root_fields {
            if matches!(key.as_str(), "artifact" | "ticks") {
                continue;
            }
            if let Some(value) = source.get(key).filter(|value| !value.is_null()) {
                replay.insert(key.clone(), self.projection.project(node, value)?);
            }
        }
        let source_contract = serde_json::json!({
            "schema": VIEWER_SCHEMA,
            "profile": VIEWER_PROFILE,
            "profile_revision": VIEWER_PROFILE_REVISION,
            "projection_sha256": VIEWER_PROJECTION_SHA256,
            "tick_count": self.tick_count,
        });
        let descriptor = serde_json::json!({
            "schema": PARTS_SCHEMA,
            "sourceContract": source_contract,
            "tickCount": self.tick_count,
            "replay": replay,
            "chunks": self.chunks,
            "producer": "rust-serde_json",
            "metrics": {
                "projectionDurationMs": self.started.elapsed().as_millis(),
                "encodeDurationMs": self.encode_duration_ms,
            },
        });
        let file = File::create(self.directory.join("parts.json"))?;
        let mut writer = BufWriter::new(file);
        serde_json::to_writer(&mut writer, &descriptor)?;
        writer.flush()?;
        Ok(())
    }
}

fn writer() -> &'static Mutex<Option<ViewerWriter>> {
    WRITER.get_or_init(|| Mutex::new(None))
}

pub fn configure(directory: &Path) -> Result<(), Box<dyn Error>> {
    *writer()
        .lock()
        .map_err(|_| "viewer writer lock is poisoned")? =
        Some(ViewerWriter::new(directory.to_owned())?);
    Ok(())
}

pub fn enabled() -> bool {
    writer().lock().is_ok_and(|guard| guard.is_some())
}

pub fn add_tick(source: &Value) -> Result<(), Box<dyn Error>> {
    if let Some(viewer) = writer()
        .lock()
        .map_err(|_| "viewer writer lock is poisoned")?
        .as_mut()
    {
        viewer.add_tick(source)?;
    }
    Ok(())
}

pub fn finish(source: &Map<String, Value>) -> Result<(), Box<dyn Error>> {
    if let Some(viewer) = writer()
        .lock()
        .map_err(|_| "viewer writer lock is poisoned")?
        .as_mut()
    {
        viewer.finish(source)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_unknown_fields_and_encodes_bounded_chunk() {
        let projection = Projection::load().expect("load projection");
        let tick = serde_json::json!({
            "current_tick": 1,
            "unknown": true,
            "players": [{"player_index": 0, "unknown": "drop"}],
        });
        let projected = projection
            .project(&projection.definitions["tick"], &tick)
            .expect("project tick");
        assert_eq!(
            projected,
            serde_json::json!({"current_tick": 1, "players": [{"player_index": 0}]})
        );
        assert_eq!(
            projected
                .as_object()
                .expect("projected tick object")
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["current_tick", "players"]
        );
        let encoded = encode_chunk(&[projected], 7).expect("encode chunk");
        assert_eq!(&encoded[..5], b"HSRD\x01");
    }

    #[test]
    fn serde_json_uses_round_trip_float_parsing() {
        let value: Value = serde_json::from_str("-4.0790786215438857e-7").expect("parse float");
        assert_eq!(
            value.as_f64().expect("float").to_bits(),
            (-4.0790786215438857e-7_f64).to_bits()
        );
    }

    #[test]
    fn rejects_source_values_beyond_the_pinned_json_depth() {
        let mut value = Value::Null;
        for _ in 0..31 {
            value = Value::Array(vec![value]);
        }
        assert!(validate_json_safety(&value, 3).is_err());
    }

    #[test]
    fn delta_encoding_is_deterministic() {
        let ticks = vec![
            serde_json::json!({"current_tick": 1, "position": [1.0, 2.0, 3.0]}),
            serde_json::json!({"current_tick": 2, "position": [1.5, 2.0, 3.0]}),
        ];
        assert_eq!(
            encode_chunk(&ticks, 0).expect("first encode"),
            encode_chunk(&ticks, 0).expect("second encode")
        );
    }

    #[test]
    fn matches_the_frontend_v1_reference_bytes() {
        let ticks = vec![
            serde_json::json!({
                "current_tick": 1,
                "players": [{"player_index": 0, "x": 1.5, "name": "A"}],
                "flags": [true, false, null],
            }),
            serde_json::json!({
                "current_tick": 2,
                "players": [{"player_index": 0, "x": 1.75, "name": "A"}],
                "flags": [true, false, null],
            }),
            serde_json::json!({
                "current_tick": 3,
                "players": [{"player_index": 0, "x": 2.0, "name": "B"}],
                "flags": [true, true, null],
            }),
        ];
        let expected_hex = concat!(
            "4853524401070308031963757272656e745f7469636b0300010f706c6179657273",
            "0701080319706c617965725f696e6465780300000378040000c03f096e616d6506",
            "03410b666c61677307030201000200020006020207020001060580808001020003",
            "0006020207020002060d0008010603420c030301010102",
        );
        let expected = (0..expected_hex.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&expected_hex[index..index + 2], 16).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(encode_chunk(&ticks, 7).expect("encode chunk"), expected);
    }

    #[test]
    fn matches_the_api_projection_fixture_and_frontend_golden_chunk() {
        let source: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/replays/viewer_v1_canonical.json"
        ))
        .expect("canonical fixture");
        let expected: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/replays/viewer_v1_projected.json"
        ))
        .expect("projected fixture");
        let projection = Projection::load().expect("load projection");
        let source_ticks = source["ticks"].as_array().expect("source ticks");
        let expected_ticks = expected["ticks"].as_array().expect("expected ticks");
        let projected_ticks = source_ticks
            .iter()
            .map(|tick| projection.project(&projection.definitions["tick"], tick))
            .collect::<Result<Vec<_>, _>>()
            .expect("project ticks");

        assert_eq!(
            serde_json::to_vec(&projected_ticks).expect("serialize projected ticks"),
            serde_json::to_vec(expected_ticks).expect("serialize expected ticks")
        );
        assert_eq!(
            encode_chunk(&projected_ticks, 0).expect("encode projected ticks"),
            include_bytes!("../../tests/fixtures/replays/viewer_v1_delta_chunk.hsrd")
        );

        for (key, node) in &projection.root_fields {
            if matches!(key.as_str(), "artifact" | "ticks") {
                continue;
            }
            let Some(value) = source.get(key).filter(|value| !value.is_null()) else {
                continue;
            };
            let projected = projection.project(node, value).expect("project root value");
            assert_eq!(
                serde_json::to_vec(&projected).expect("serialize projected root value"),
                serde_json::to_vec(&expected[key]).expect("serialize expected root value"),
                "root projection mismatch for {key}"
            );
        }
    }
}
