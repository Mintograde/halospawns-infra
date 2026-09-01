use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::error::Error;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const VIEWER_SCHEMA: &str = "halospawns.viewerReplay.v1";
const VIEWER_PROFILE: &str = "frontend-default";
const VIEWER_PROFILE_REVISION: u32 = 1;
const VIEWER_PROJECTION_SHA256: &str =
    "573da0d397c796d686354b7269094409984304961f8c55ab03bb2e46180d21ec";
const PARTS_SCHEMA: &str = "halospawns.viewerReplayDeltaParts.v1";
const CONTAINER_RESULT_SCHEMA: &str = "halospawns.viewerReplayDeltaContainer.v1";
const VIEWER_DELTA_FORMAT: &str = "halospawns.viewerReplayDelta.v1";
const CONTAINER_MAGIC: &[u8; 8] = b"HSRDC001";
const CONTAINER_HEADER_BYTES: usize = 32;
const CONTAINER_VERSION: u16 = 1;
const MANIFEST_COMPRESSION: u32 = 1;
const CHUNK_MAGIC: &[u8; 4] = b"HSRD";
const CHUNK_VERSION: u8 = 1;
const KEYFRAME_INTERVAL: usize = 2048;
const MAX_TICKS: usize = 432_000;
const MAX_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_JSON_DEPTH: usize = 32;
const MAX_STRING_CHARACTERS: usize = 64 * 1024 * 1024;
const SAFE_INTEGER_MAX: f64 = 9_007_199_254_740_991.0;
const ZSTD_LEVEL: i32 = 19;
const COPY_BUFFER_BYTES: usize = 1024 * 1024;

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
static PROJECTION: OnceLock<Result<Projection, String>> = OnceLock::new();

#[derive(Debug)]
struct Projection {
    definitions: Map<String, Value>,
    limits: Map<String, Value>,
    root_fields: Map<String, Value>,
    tick: CompiledProjection,
}

#[derive(Debug)]
struct CompiledObjectField {
    output_key: String,
    source_key: String,
    node: CompiledProjection,
}

#[derive(Debug)]
enum CompiledProjection {
    Scalar {
        nullable: bool,
    },
    Object {
        fields: Vec<CompiledObjectField>,
        required: Vec<String>,
    },
    Map {
        limit: usize,
        values: Box<CompiledProjection>,
    },
    Array {
        limit: usize,
        take_first: bool,
        items: Box<CompiledProjection>,
    },
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
        let tick = compile_projection(
            &definitions,
            &limits,
            definitions
                .get("tick")
                .ok_or("viewer tick projection is missing")?,
            0,
        )?;
        Ok(Self {
            definitions,
            limits,
            root_fields,
            tick,
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

fn resolve_projection_node<'a>(
    definitions: &'a Map<String, Value>,
    mut node: &'a Value,
) -> Result<&'a Value, Box<dyn Error>> {
    let mut depth = 0;
    while node.get("kind").and_then(Value::as_str) == Some("ref") {
        let name = node
            .get("name")
            .and_then(Value::as_str)
            .ok_or("viewer projection reference has no name")?;
        node = definitions
            .get(name)
            .ok_or("viewer projection reference is unknown")?;
        depth += 1;
        if depth > MAX_JSON_DEPTH {
            return Err("viewer projection reference cycle".into());
        }
    }
    Ok(node)
}

fn compiled_limit(
    limits: &Map<String, Value>,
    node: &Map<String, Value>,
) -> Result<usize, Box<dyn Error>> {
    let raw = node
        .get("take_first")
        .or_else(|| node.get("max_items"))
        .or_else(|| node.get("limit"))
        .ok_or("viewer projection collection has no limit")?;
    let value = if let Some(name) = raw.as_str() {
        limits
            .get(name)
            .and_then(Value::as_u64)
            .ok_or("viewer projection named limit is invalid")?
    } else {
        raw.as_u64().ok_or("viewer projection limit is invalid")?
    };
    usize::try_from(value).map_err(Into::into)
}

fn compile_projection(
    definitions: &Map<String, Value>,
    limits: &Map<String, Value>,
    node: &Value,
    depth: usize,
) -> Result<CompiledProjection, Box<dyn Error>> {
    if depth > MAX_JSON_DEPTH {
        return Err("viewer projection exceeds the maximum depth".into());
    }
    let node = resolve_projection_node(definitions, node)?;
    if node.as_str() == Some("scalar") {
        return Ok(CompiledProjection::Scalar { nullable: false });
    }
    if node.as_str() == Some("nullable_scalar") {
        return Ok(CompiledProjection::Scalar { nullable: true });
    }
    let specification = node
        .as_object()
        .ok_or("viewer projection node is malformed")?;
    match specification.get("kind").and_then(Value::as_str) {
        Some("object") => {
            let source_fields = specification
                .get("fields")
                .and_then(Value::as_object)
                .ok_or("viewer projection object fields are malformed")?;
            let mut fields = Vec::with_capacity(source_fields.len());
            for (output_key, child) in source_fields {
                if child.get("kind").and_then(Value::as_str) == Some("generated") {
                    continue;
                }
                let source_key = child
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or(output_key)
                    .to_owned();
                fields.push(CompiledObjectField {
                    output_key: output_key.clone(),
                    source_key,
                    node: compile_projection(definitions, limits, child, depth + 1)?,
                });
            }
            let required = specification
                .get("required")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .map(|value| {
                            value
                                .as_str()
                                .map(str::to_owned)
                                .ok_or("viewer projection required field is malformed")
                        })
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()?
                .unwrap_or_default();
            Ok(CompiledProjection::Object { fields, required })
        }
        Some("map") => Ok(CompiledProjection::Map {
            limit: compiled_limit(limits, specification)?,
            values: Box::new(compile_projection(
                definitions,
                limits,
                specification
                    .get("values")
                    .ok_or("viewer projection map values are missing")?,
                depth + 1,
            )?),
        }),
        Some("array") => Ok(CompiledProjection::Array {
            limit: compiled_limit(limits, specification)?,
            take_first: specification.contains_key("take_first"),
            items: Box::new(compile_projection(
                definitions,
                limits,
                specification
                    .get("items")
                    .ok_or("viewer projection array items are missing")?,
                depth + 1,
            )?),
        }),
        _ => Err("viewer projection node kind is unsupported".into()),
    }
}

impl CompiledProjection {
    fn project(&self, source: &Value) -> Result<Value, Box<dyn Error>> {
        match self {
            Self::Scalar { nullable } => project_scalar(source, *nullable),
            Self::Object {
                fields, required, ..
            } => {
                let source = source
                    .as_object()
                    .ok_or("viewer projection expected an object")?;
                for required_key in required {
                    if source.get(required_key).is_none_or(Value::is_null) {
                        return Err("viewer projection is missing a required object field".into());
                    }
                }
                let mut output = Map::with_capacity(fields.len());
                for field in fields {
                    if let Some(value) = source
                        .get(&field.source_key)
                        .filter(|value| !value.is_null())
                    {
                        output.insert(field.output_key.clone(), field.node.project(value)?);
                    }
                }
                Ok(Value::Object(output))
            }
            Self::Map { limit, values } => {
                let source = source
                    .as_object()
                    .ok_or("viewer projection expected a dynamic object map")?;
                if source.len() > *limit {
                    return Err("viewer projection map exceeds its pinned limit".into());
                }
                source
                    .iter()
                    .filter(|(_, value)| !value.is_null())
                    .map(|(key, value)| Ok((key.clone(), values.project(value)?)))
                    .collect::<Result<Map<_, _>, _>>()
                    .map(Value::Object)
            }
            Self::Array {
                limit,
                take_first,
                items,
            } => {
                let source = source
                    .as_array()
                    .ok_or("viewer projection expected an array")?;
                if !take_first && source.len() > *limit {
                    return Err("viewer projection array exceeds its pinned limit".into());
                }
                source
                    .iter()
                    .take(*limit)
                    .map(|value| items.project(value))
                    .collect::<Result<Vec<_>, _>>()
                    .map(Value::Array)
            }
        }
    }
}

fn projection() -> Result<&'static Projection, Box<dyn Error>> {
    match PROJECTION.get_or_init(|| Projection::load().map_err(|error| error.to_string())) {
        Ok(projection) => Ok(projection),
        Err(error) => Err(error.clone().into()),
    }
}

pub fn project_tick(source: &Value) -> Result<(Value, [u8; 32], Duration), Box<dyn Error>> {
    let started = Instant::now();
    validate_json_safety(source, 3)?;
    let projected = projection()?.tick.project(source)?;
    let semantic_digest = semantic_value_digest(&projected)?;
    Ok((projected, semantic_digest, started.elapsed()))
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

#[derive(Debug)]
struct BinaryReader<'a> {
    bytes: &'a [u8],
    offset: usize,
    strings: Vec<String>,
}

impl<'a> BinaryReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            offset: 0,
            strings: Vec::new(),
        }
    }

    fn byte(&mut self) -> Result<u8, Box<dyn Error>> {
        let value = self
            .bytes
            .get(self.offset)
            .copied()
            .ok_or("unexpected end of viewer delta chunk")?;
        self.offset += 1;
        Ok(value)
    }

    fn bytes(&mut self, length: usize) -> Result<&'a [u8], Box<dyn Error>> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or("viewer delta byte range overflow")?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or("unexpected end of viewer delta chunk")?;
        self.offset = end;
        Ok(value)
    }

    fn varuint(&mut self) -> Result<u64, Box<dyn Error>> {
        let mut value = 0_u64;
        let mut factor = 1_u64;
        for _ in 0..8 {
            let byte = self.byte()?;
            value = value
                .checked_add(u64::from(byte & 0x7f) * factor)
                .ok_or("viewer delta integer overflow")?;
            if byte < 128 {
                if value > SAFE_INTEGER_MAX as u64 {
                    return Err("viewer delta integer exceeds the safe range".into());
                }
                return Ok(value);
            }
            factor = factor
                .checked_mul(128)
                .ok_or("viewer delta integer overflow")?;
        }
        Err("viewer delta integer is malformed".into())
    }

    fn string(&mut self) -> Result<String, Box<dyn Error>> {
        let token = self.varuint()?;
        if token % 2 == 0 {
            let index = usize::try_from(token / 2)?;
            return self
                .strings
                .get(index)
                .cloned()
                .ok_or_else(|| "viewer delta string reference is malformed".into());
        }
        let length = usize::try_from((token - 1) / 2)?;
        let value = std::str::from_utf8(self.bytes(length)?)?.to_owned();
        self.strings.push(value.clone());
        Ok(value)
    }
}

fn number_value(value: f64) -> Result<Value, Box<dyn Error>> {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| "viewer delta decoded a non-finite number".into())
}

fn read_value(reader: &mut BinaryReader<'_>, depth: usize) -> Result<Value, Box<dyn Error>> {
    if depth > MAX_JSON_DEPTH {
        return Err("viewer delta decoded value exceeds the maximum depth".into());
    }
    match reader.byte()? {
        VALUE_NULL => Ok(Value::Null),
        VALUE_FALSE => Ok(Value::Bool(false)),
        VALUE_TRUE => Ok(Value::Bool(true)),
        VALUE_INTEGER => {
            let sign = reader.byte()?;
            if sign > 1 {
                return Err("viewer delta integer sign is malformed".into());
            }
            let magnitude = reader.varuint()?;
            let integer = i64::try_from(magnitude)?;
            Ok(Value::Number(
                (if sign == 1 { -integer } else { integer }).into(),
            ))
        }
        VALUE_FLOAT32 => {
            let bytes: [u8; 4] = reader.bytes(4)?.try_into()?;
            number_value(f64::from(f32::from_le_bytes(bytes)))
        }
        VALUE_FLOAT64 => {
            let bytes: [u8; 8] = reader.bytes(8)?.try_into()?;
            number_value(f64::from_le_bytes(bytes))
        }
        VALUE_STRING => Ok(Value::String(reader.string()?)),
        VALUE_ARRAY => {
            let length = usize::try_from(reader.varuint()?)?;
            let mut values = Vec::with_capacity(length);
            for _ in 0..length {
                values.push(read_value(reader, depth + 1)?);
            }
            Ok(Value::Array(values))
        }
        VALUE_OBJECT => {
            let length = usize::try_from(reader.varuint()?)?;
            let mut values = Map::with_capacity(length);
            for _ in 0..length {
                values.insert(reader.string()?, read_value(reader, depth + 1)?);
            }
            Ok(Value::Object(values))
        }
        tag => Err(format!("unknown viewer delta value tag {tag}").into()),
    }
}

fn decode_signed_difference(value: u64) -> Result<i64, Box<dyn Error>> {
    if value.is_multiple_of(2) {
        Ok(i64::try_from(value / 2)?)
    } else {
        Ok(-i64::try_from(value.div_ceil(2))?)
    }
}

fn read_packed_unsigned(
    reader: &mut BinaryReader<'_>,
    count: usize,
    bit_width: u8,
) -> Result<Vec<u64>, Box<dyn Error>> {
    if bit_width == 0 {
        return Ok(vec![0; count]);
    }
    if bit_width > 32 {
        return Err("viewer delta packed bit width is malformed".into());
    }
    let mask = (1_u64 << bit_width) - 1;
    let mut values = Vec::with_capacity(count);
    let mut accumulator = 0_u64;
    let mut accumulator_bits = 0_u8;
    while values.len() < count {
        while accumulator_bits < bit_width {
            accumulator |= u64::from(reader.byte()?) << accumulator_bits;
            accumulator_bits += 8;
        }
        values.push(accumulator & mask);
        accumulator >>= bit_width;
        accumulator_bits -= bit_width;
    }
    Ok(values)
}

fn float32_bits(value: &Value) -> Result<u32, Box<dyn Error>> {
    let value = number(value)
        .filter(|value| exact_f32(*value))
        .ok_or("viewer delta float32 base is malformed")?;
    Ok((value as f32).to_bits())
}

fn float32_value(bits: u32) -> Result<Value, Box<dyn Error>> {
    number_value(f64::from(f32::from_bits(bits)))
}

fn patched_float32_bits(base: u32, encoded: u64, xor: bool) -> Result<u32, Box<dyn Error>> {
    if xor {
        let encoded =
            u32::try_from(encoded).map_err(|_| "viewer delta float32 XOR value is malformed")?;
        Ok(base ^ encoded)
    } else {
        let difference = decode_signed_difference(encoded)?;
        let difference = i32::try_from(difference)
            .map_err(|_| "viewer delta float32 difference is malformed")?;
        Ok(base.wrapping_add_signed(difference))
    }
}

fn read_patched_value(
    reader: &mut BinaryReader<'_>,
    previous: Option<&Value>,
    before_previous: Option<&Value>,
    depth: usize,
) -> Result<Value, Box<dyn Error>> {
    if depth > MAX_JSON_DEPTH {
        return Err("viewer delta patch exceeds the maximum depth".into());
    }
    let tag = reader.byte()?;
    match tag {
        DELTA_SAME => previous
            .cloned()
            .ok_or_else(|| "viewer delta same-value base is missing".into()),
        DELTA_REPLACE => read_value(reader, depth),
        DELTA_NUMBER_XOR => {
            let previous = number(previous.ok_or("viewer number XOR base is missing")?)
                .ok_or("viewer number XOR base is malformed")?;
            let descriptor = reader.byte()?;
            let trailing_bytes = usize::from(descriptor >> 4);
            let significant_bytes = usize::from(descriptor & 0x0f) + 1;
            if trailing_bytes + significant_bytes > 8 {
                return Err("viewer number XOR delta is malformed".into());
            }
            let mut significant = 0_u64;
            for (index, byte) in reader.bytes(significant_bytes)?.iter().enumerate() {
                significant |= u64::from(*byte) << (index * 8);
            }
            number_value(f64::from_bits(
                previous.to_bits() ^ (significant << (trailing_bytes * 8)),
            ))
        }
        DELTA_FLOAT32_XOR | DELTA_FLOAT32_DIFFERENCE => {
            let base = float32_bits(previous.ok_or("viewer float32 base is missing")?)?;
            float32_value(patched_float32_bits(
                base,
                reader.varuint()?,
                tag == DELTA_FLOAT32_XOR,
            )?)
        }
        DELTA_INTEGER_DIFFERENCE => {
            let previous = number(previous.ok_or("viewer integer delta base is missing")?)
                .filter(|value| value.fract() == 0.0 && value.abs() <= SAFE_INTEGER_MAX)
                .ok_or("viewer integer delta base is malformed")?;
            let value = previous as i64 + decode_signed_difference(reader.varuint()?)?;
            if (value as f64).abs() > SAFE_INTEGER_MAX {
                return Err("viewer integer delta exceeds the safe range".into());
            }
            Ok(Value::Number(value.into()))
        }
        DELTA_FLOAT32_BIT_PREDICTION | DELTA_FLOAT32_VALUE_PREDICTION => {
            let previous = number(previous.ok_or("viewer prediction base is missing")?)
                .filter(|value| exact_f32(*value))
                .ok_or("viewer prediction base is malformed")?;
            let before_previous =
                number(before_previous.ok_or("viewer prediction history is missing")?)
                    .filter(|value| exact_f32(*value))
                    .ok_or("viewer prediction history is malformed")?;
            let prediction = if tag == DELTA_FLOAT32_BIT_PREDICTION {
                predict_bits(before_previous, previous)
            } else {
                predict_value_bits(before_previous, previous)
            };
            float32_value(patched_float32_bits(prediction, reader.varuint()?, false)?)
        }
        DELTA_OBJECT => {
            let previous = previous
                .and_then(Value::as_object)
                .ok_or("viewer object delta base is malformed")?;
            let before_previous = before_previous.and_then(Value::as_object);
            let mut output = previous.clone();
            for _ in 0..reader.varuint()? {
                output.shift_remove(&reader.string()?);
            }
            for _ in 0..reader.varuint()? {
                let key = reader.string()?;
                let value = read_patched_value(
                    reader,
                    previous.get(&key),
                    before_previous.and_then(|values| values.get(&key)),
                    depth + 1,
                )?;
                output.insert(key, value);
            }
            Ok(Value::Object(output))
        }
        DELTA_ARRAY => {
            let previous = previous
                .and_then(Value::as_array)
                .ok_or("viewer array delta base is malformed")?;
            let before_previous = before_previous.and_then(Value::as_array);
            let length = usize::try_from(reader.varuint()?)?;
            let mut output = previous
                .iter()
                .take(length)
                .cloned()
                .map(Some)
                .collect::<Vec<_>>();
            output.resize(length, None);
            for _ in 0..reader.varuint()? {
                let index = usize::try_from(reader.varuint()?)?;
                if index >= length {
                    return Err("viewer array delta index is malformed".into());
                }
                output[index] = Some(read_patched_value(
                    reader,
                    previous.get(index),
                    before_previous.and_then(|values| values.get(index)),
                    depth + 1,
                )?);
            }
            output
                .into_iter()
                .collect::<Option<Vec<_>>>()
                .map(Value::Array)
                .ok_or_else(|| "viewer array delta left an undefined item".into())
        }
        DELTA_DENSE_ARRAY => {
            let previous = previous
                .and_then(Value::as_array)
                .ok_or("viewer dense array delta base is malformed")?;
            let before_previous = before_previous.and_then(Value::as_array);
            previous
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    read_patched_value(
                        reader,
                        Some(value),
                        before_previous.and_then(|values| values.get(index)),
                        depth + 1,
                    )
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
        DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY
        | DELTA_DENSE_FLOAT32_XOR_ARRAY
        | DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY
        | DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY
        | DELTA_DENSE_FLOAT32_BITPACKED_ARRAY => {
            let previous = previous
                .and_then(Value::as_array)
                .ok_or("viewer dense float32 array base is malformed")?;
            let previous_bits = previous
                .iter()
                .map(float32_bits)
                .collect::<Result<Vec<_>, _>>()?;
            let before_previous_values = before_previous.and_then(Value::as_array);
            let before_previous_bits = before_previous_values
                .map(|values| {
                    if values.len() != previous.len() {
                        return Err("viewer dense prediction history length is malformed".into());
                    }
                    values
                        .iter()
                        .map(float32_bits)
                        .collect::<Result<Vec<_>, Box<dyn Error>>>()
                })
                .transpose()?;

            let mut output = Vec::with_capacity(previous.len());
            if tag == DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY || tag == DELTA_DENSE_FLOAT32_XOR_ARRAY {
                for base in previous_bits {
                    output.push(float32_value(patched_float32_bits(
                        base,
                        reader.varuint()?,
                        tag == DELTA_DENSE_FLOAT32_XOR_ARRAY,
                    )?)?);
                }
                return Ok(Value::Array(output));
            }

            if tag == DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY
                || tag == DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY
            {
                let history = before_previous_bits
                    .as_ref()
                    .ok_or("viewer dense prediction history is missing")?;
                for index in 0..previous.len() {
                    let before = f64::from(f32::from_bits(history[index]));
                    let previous_value = f64::from(f32::from_bits(previous_bits[index]));
                    let prediction = if tag == DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY {
                        predict_bits(before, previous_value)
                    } else {
                        predict_value_bits(before, previous_value)
                    };
                    output.push(float32_value(patched_float32_bits(
                        prediction,
                        reader.varuint()?,
                        false,
                    )?)?);
                }
                return Ok(Value::Array(output));
            }

            let mode = reader.byte()?;
            let bit_width = reader.byte()?;
            if mode > FLOAT32_MODE_VALUE_PREDICTION || bit_width > 32 {
                return Err("viewer dense bitpacked metadata is malformed".into());
            }
            if mode >= FLOAT32_MODE_BIT_PREDICTION && before_previous_bits.is_none() {
                return Err("viewer dense bitpacked prediction history is missing".into());
            }
            let residuals = read_packed_unsigned(reader, previous.len(), bit_width)?;
            for index in 0..previous.len() {
                let base = match mode {
                    FLOAT32_MODE_XOR | FLOAT32_MODE_DIFFERENCE => previous_bits[index],
                    FLOAT32_MODE_BIT_PREDICTION => predict_bits(
                        f64::from(f32::from_bits(
                            before_previous_bits.as_ref().unwrap()[index],
                        )),
                        f64::from(f32::from_bits(previous_bits[index])),
                    ),
                    FLOAT32_MODE_VALUE_PREDICTION => predict_value_bits(
                        f64::from(f32::from_bits(
                            before_previous_bits.as_ref().unwrap()[index],
                        )),
                        f64::from(f32::from_bits(previous_bits[index])),
                    ),
                    _ => unreachable!(),
                };
                output.push(float32_value(patched_float32_bits(
                    base,
                    residuals[index],
                    mode == FLOAT32_MODE_XOR,
                )?)?);
            }
            Ok(Value::Array(output))
        }
        _ => Err(format!("unknown viewer delta tag {tag}").into()),
    }
}

#[cfg(test)]
fn decode_chunk(bytes: &[u8]) -> Result<(usize, Vec<Value>), Box<dyn Error>> {
    let mut reader = BinaryReader::new(bytes);
    if reader.bytes(4)? != CHUNK_MAGIC {
        return Err("viewer delta chunk magic is invalid".into());
    }
    if reader.byte()? != CHUNK_VERSION {
        return Err("viewer delta chunk version is unsupported".into());
    }
    let first_tick = usize::try_from(reader.varuint()?)?;
    let tick_count = usize::try_from(reader.varuint()?)?;
    if !(1..=KEYFRAME_INTERVAL).contains(&tick_count) {
        return Err("viewer delta chunk tick count is invalid".into());
    }
    let mut ticks = Vec::with_capacity(tick_count);
    ticks.push(read_value(&mut reader, 1)?);
    for index in 1..tick_count {
        ticks.push(read_patched_value(
            &mut reader,
            ticks.get(index - 1),
            index.checked_sub(2).and_then(|before| ticks.get(before)),
            1,
        )?);
    }
    if reader.offset != bytes.len() {
        return Err("viewer delta chunk contains trailing bytes".into());
    }
    Ok((first_tick, ticks))
}

fn deep_exact_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(_), Value::Number(_)) => number(left)
            .zip(number(right))
            .is_some_and(|(left, right)| left.to_bits() == right.to_bits()),
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| deep_exact_equal(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|((left_key, left), (right_key, right))| {
                        left_key == right_key && deep_exact_equal(left, right)
                    })
        }
        _ => left == right,
    }
}

fn write_json_string(output: &mut Vec<u8>, value: &str) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    output.push(b'"');
    for character in value.chars() {
        match character {
            '"' => output.extend_from_slice(br#"\""#),
            '\\' => output.extend_from_slice(br#"\\"#),
            '\u{0008}' => output.extend_from_slice(br#"\b"#),
            '\u{0009}' => output.extend_from_slice(br#"\t"#),
            '\u{000a}' => output.extend_from_slice(br#"\n"#),
            '\u{000c}' => output.extend_from_slice(br#"\f"#),
            '\u{000d}' => output.extend_from_slice(br#"\r"#),
            character if character < '\u{0020}' => {
                let value = character as u8;
                output.extend_from_slice(br#"\u00"#);
                output.push(HEX[usize::from(value >> 4)]);
                output.push(HEX[usize::from(value & 0x0f)]);
            }
            character => {
                let mut encoded = [0_u8; 4];
                output.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
            }
        }
    }
    output.push(b'"');
}

fn javascript_number(value: f64) -> Result<String, Box<dyn Error>> {
    if !value.is_finite() {
        return Err("tick hash rejects non-finite numbers".into());
    }
    if value == 0.0 {
        return Ok("0".to_owned());
    }
    let mut buffer = ryu::Buffer::new();
    let text = buffer.format_finite(value).to_ascii_lowercase();
    let Some((mantissa, raw_exponent)) = text.split_once('e') else {
        return Ok(text.strip_suffix(".0").unwrap_or(&text).to_owned());
    };
    let exponent: i32 = raw_exponent.parse()?;
    let negative = mantissa.starts_with('-');
    let mantissa = mantissa.strip_prefix('-').unwrap_or(mantissa);
    let digits = mantissa.replace('.', "");
    let decimal_position = 1 + exponent;
    let absolute = value.abs();
    let rendered = if (1e-6..1e21).contains(&absolute) {
        if decimal_position <= 0 {
            format!("0.{}{}", "0".repeat((-decimal_position) as usize), digits)
        } else if usize::try_from(decimal_position).is_ok_and(|position| position >= digits.len()) {
            let position = usize::try_from(decimal_position)?;
            format!("{}{}", digits, "0".repeat(position - digits.len()))
        } else {
            let position = usize::try_from(decimal_position)?;
            format!("{}.{}", &digits[..position], &digits[position..])
        }
    } else {
        let mut rendered = digits[..1].to_owned();
        if digits.len() > 1 {
            rendered.push('.');
            rendered.push_str(&digits[1..]);
        }
        rendered.push('e');
        if exponent >= 0 {
            rendered.push('+');
        }
        rendered.push_str(&exponent.to_string());
        rendered
    };
    Ok(if negative {
        format!("-{rendered}")
    } else {
        rendered
    })
}

fn write_tick_json(output: &mut Vec<u8>, value: &Value) -> Result<(), Box<dyn Error>> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(true) => output.extend_from_slice(b"true"),
        Value::Bool(false) => output.extend_from_slice(b"false"),
        Value::Number(_) => {
            let value = number(value).ok_or("tick hash number is malformed")?;
            if value.fract() == 0.0 && value.abs() <= SAFE_INTEGER_MAX && !negative_zero(value) {
                output.extend_from_slice((value as i64).to_string().as_bytes());
            } else {
                output.extend_from_slice(javascript_number(value)?.as_bytes());
            }
        }
        Value::String(value) => write_json_string(output, value),
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_tick_json(output, value)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            for (index, (key, value)) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_json_string(output, key);
                output.push(b':');
                write_tick_json(output, value)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn digest_hex(bytes: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = bytes.as_ref();
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[usize::from(byte >> 4)] as char);
        output.push(HEX[usize::from(byte & 0x0f)] as char);
    }
    output
}

fn sha256_hex(bytes: &[u8]) -> String {
    digest_hex(Sha256::digest(bytes))
}

struct TickHasher {
    digest: Sha256,
    serialized: Vec<u8>,
}

impl TickHasher {
    fn new() -> Self {
        Self {
            digest: Sha256::new(),
            serialized: Vec::new(),
        }
    }

    fn update(&mut self, tick: &Value) -> Result<(), Box<dyn Error>> {
        self.serialized.clear();
        write_tick_json(&mut self.serialized, tick)?;
        self.digest
            .update(self.serialized.len().to_string().as_bytes());
        self.digest.update(b":");
        self.digest.update(&self.serialized);
        Ok(())
    }

    fn finish(self) -> String {
        digest_hex(self.digest.finalize())
    }
}

fn update_semantic_hash(digest: &mut Sha256, value: &Value) -> Result<(), Box<dyn Error>> {
    match value {
        Value::Null => digest.update([VALUE_NULL]),
        Value::Bool(false) => digest.update([VALUE_FALSE]),
        Value::Bool(true) => digest.update([VALUE_TRUE]),
        Value::Number(_) => {
            digest.update([VALUE_FLOAT64]);
            digest.update(
                number(value)
                    .ok_or("invalid JSON number")?
                    .to_bits()
                    .to_le_bytes(),
            );
        }
        Value::String(value) => {
            digest.update([VALUE_STRING]);
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        }
        Value::Array(values) => {
            digest.update([VALUE_ARRAY]);
            digest.update((values.len() as u64).to_le_bytes());
            for value in values {
                update_semantic_hash(digest, value)?;
            }
        }
        Value::Object(values) => {
            digest.update([VALUE_OBJECT]);
            digest.update((values.len() as u64).to_le_bytes());
            for (key, value) in values {
                digest.update((key.len() as u64).to_le_bytes());
                digest.update(key.as_bytes());
                update_semantic_hash(digest, value)?;
            }
        }
    }
    Ok(())
}

fn semantic_value_digest(value: &Value) -> Result<[u8; 32], Box<dyn Error>> {
    let mut digest = Sha256::new();
    update_semantic_hash(&mut digest, value)?;
    Ok(digest.finalize().into())
}

fn semantic_tick_hash(digests: &[[u8; 32]]) -> String {
    let mut digest = Sha256::new();
    digest.update((digests.len() as u64).to_le_bytes());
    for value in digests {
        digest.update(value);
    }
    digest_hex(digest.finalize())
}

fn decode_chunk_semantic_hash(bytes: &[u8]) -> Result<(usize, usize, String), Box<dyn Error>> {
    let mut reader = BinaryReader::new(bytes);
    if reader.bytes(4)? != CHUNK_MAGIC || reader.byte()? != CHUNK_VERSION {
        return Err("viewer delta chunk header is invalid".into());
    }
    let first_tick = usize::try_from(reader.varuint()?)?;
    let tick_count = usize::try_from(reader.varuint()?)?;
    if !(1..=KEYFRAME_INTERVAL).contains(&tick_count) {
        return Err("viewer delta chunk tick count is invalid".into());
    }

    let mut digest = Sha256::new();
    digest.update((tick_count as u64).to_le_bytes());
    let mut previous = read_value(&mut reader, 1)?;
    digest.update(semantic_value_digest(&previous)?);
    let mut before_previous = None;
    for _ in 1..tick_count {
        let next = read_patched_value(&mut reader, Some(&previous), before_previous.as_ref(), 1)?;
        digest.update(semantic_value_digest(&next)?);
        before_previous = Some(previous);
        previous = next;
    }
    if reader.offset != bytes.len() {
        return Err("viewer delta chunk contains trailing bytes".into());
    }
    Ok((first_tick, tick_count, digest_hex(digest.finalize())))
}

fn validate_zstd_round_trip(compressed: &[u8], raw: &[u8]) -> Result<(), Box<dyn Error>> {
    let mut decoder = zstd::stream::read::Decoder::new(compressed)?;
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut offset = 0_usize;
    loop {
        let read = decoder.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let end = offset
            .checked_add(read)
            .ok_or("viewer zstd validation byte count overflow")?;
        if raw.get(offset..end) != Some(&buffer[..read]) {
            return Err("viewer chunk compression changed encoded bytes".into());
        }
        offset = end;
    }
    if offset != raw.len() {
        return Err("viewer chunk compression truncated encoded bytes".into());
    }
    Ok(())
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
    (64 - value.leading_zeros() as usize).max(1).div_ceil(7)
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
    let significant_bytes = (64 - significant.leading_zeros() as usize).div_ceil(8);
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
        if previous.len() == next.len()
            && !next.is_empty()
            && let (Some(previous_float), Some(next_float)) =
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkPart {
    index: usize,
    first_tick: usize,
    tick_count: usize,
    raw_bytes: usize,
    compressed_file: String,
    compressed_bytes: usize,
    compressed_sha256: String,
    tick_sha256: String,
}

struct ChunkTask {
    directory: PathBuf,
    index: usize,
    first_tick: usize,
    tick_count: usize,
    raw: Vec<u8>,
    expected_tick_sha256: String,
    expected_semantic_sha256: String,
}

struct ChunkWorkResult {
    part: ChunkPart,
    validation_duration_ms: u128,
    compression_duration_ms: u128,
    chunk_write_duration_ms: u128,
}

type ChunkWorkMessage = Result<ChunkWorkResult, String>;

fn configured_worker_count() -> Result<usize, Box<dyn Error>> {
    let Some(value) = env::var_os("VIEWER_ARTIFACT_WORKERS") else {
        return Ok(1);
    };
    let value = value
        .to_str()
        .ok_or("VIEWER_ARTIFACT_WORKERS must be UTF-8")?
        .parse::<usize>()?;
    if !(1..=8).contains(&value) {
        return Err("VIEWER_ARTIFACT_WORKERS must be between 1 and 8".into());
    }
    Ok(value)
}

fn process_chunk(
    task: ChunkTask,
    compressor: &mut zstd::bulk::Compressor<'static>,
) -> Result<ChunkWorkResult, Box<dyn Error>> {
    let validation_started = Instant::now();
    let (decoded_first_tick, decoded_tick_count, decoded_semantic_sha256) =
        decode_chunk_semantic_hash(&task.raw)?;
    if decoded_first_tick != task.first_tick
        || decoded_tick_count != task.tick_count
        || decoded_semantic_sha256 != task.expected_semantic_sha256
    {
        return Err("viewer delta chunk failed lossless semantic validation".into());
    }
    let mut validation_duration_ms = validation_started.elapsed().as_millis();

    let compression_started = Instant::now();
    let compressed = compressor.compress(&task.raw)?;
    let compression_duration_ms = compression_started.elapsed().as_millis();

    let validation_started = Instant::now();
    validate_zstd_round_trip(&compressed, &task.raw)?;
    validation_duration_ms += validation_started.elapsed().as_millis();

    let compressed_file = format!("chunk-{:05}.hsrd.zst", task.index);
    let write_started = Instant::now();
    fs::write(task.directory.join(&compressed_file), &compressed)?;
    let chunk_write_duration_ms = write_started.elapsed().as_millis();
    Ok(ChunkWorkResult {
        part: ChunkPart {
            index: task.index,
            first_tick: task.first_tick,
            tick_count: task.tick_count,
            raw_bytes: task.raw.len(),
            compressed_file,
            compressed_bytes: compressed.len(),
            compressed_sha256: sha256_hex(&compressed),
            tick_sha256: task.expected_tick_sha256,
        },
        validation_duration_ms,
        compression_duration_ms,
        chunk_write_duration_ms,
    })
}

fn chunk_worker(tasks: Arc<Mutex<Receiver<ChunkTask>>>, results: mpsc::Sender<ChunkWorkMessage>) {
    let compressor = zstd::bulk::Compressor::new(ZSTD_LEVEL).and_then(|mut compressor| {
        compressor.include_checksum(true)?;
        compressor.include_contentsize(true)?;
        Ok(compressor)
    });
    let mut compressor = match compressor {
        Ok(compressor) => compressor,
        Err(error) => {
            let _ = results.send(Err(format!(
                "viewer zstd worker initialization failed: {error}"
            )));
            return;
        }
    };
    loop {
        let task = match tasks.lock() {
            Ok(tasks) => tasks.recv(),
            Err(_) => {
                let _ = results.send(Err("viewer chunk task lock is poisoned".to_owned()));
                return;
            }
        };
        let task = match task {
            Ok(task) => task,
            Err(_) => return,
        };
        let result = process_chunk(task, &mut compressor).map_err(|error| error.to_string());
        if results.send(result).is_err() {
            return;
        }
    }
}

struct ViewerWriter {
    directory: PathBuf,
    task_sender: Option<SyncSender<ChunkTask>>,
    result_receiver: Receiver<ChunkWorkMessage>,
    worker_handles: Vec<JoinHandle<()>>,
    worker_count: usize,
    started: Instant,
    projection_duration: Duration,
    encode_duration_ms: u128,
    tick_hash_duration_ms: u128,
    validation_duration_ms: u128,
    compression_duration_ms: u128,
    chunk_write_duration_ms: u128,
    pending: Vec<Value>,
    pending_semantic_digests: Vec<[u8; 32]>,
    pending_tick_hasher: TickHasher,
    tick_count: usize,
    dispatched_chunks: usize,
    raw_chunk_bytes: u64,
    compressed_chunk_bytes: u64,
    chunks: Vec<ChunkPart>,
}

impl ViewerWriter {
    fn new(directory: PathBuf) -> Result<Self, Box<dyn Error>> {
        fs::create_dir_all(&directory)?;
        projection()?;
        let worker_count = configured_worker_count()?;
        let (task_sender, task_receiver) = mpsc::sync_channel(worker_count);
        let task_receiver = Arc::new(Mutex::new(task_receiver));
        let (result_sender, result_receiver) = mpsc::channel();
        let worker_handles = (0..worker_count)
            .map(|_| {
                let tasks = Arc::clone(&task_receiver);
                let results = result_sender.clone();
                thread::spawn(move || chunk_worker(tasks, results))
            })
            .collect();
        drop(result_sender);
        Ok(Self {
            directory,
            task_sender: Some(task_sender),
            result_receiver,
            worker_handles,
            worker_count,
            started: Instant::now(),
            projection_duration: Duration::ZERO,
            encode_duration_ms: 0,
            tick_hash_duration_ms: 0,
            validation_duration_ms: 0,
            compression_duration_ms: 0,
            chunk_write_duration_ms: 0,
            pending: Vec::with_capacity(KEYFRAME_INTERVAL),
            pending_semantic_digests: Vec::with_capacity(KEYFRAME_INTERVAL),
            pending_tick_hasher: TickHasher::new(),
            tick_count: 0,
            dispatched_chunks: 0,
            raw_chunk_bytes: 0,
            compressed_chunk_bytes: 0,
            chunks: Vec::new(),
        })
    }

    fn add_tick(&mut self, source: &Value) -> Result<(), Box<dyn Error>> {
        let (projected, semantic_digest, projection_duration) = project_tick(source)?;
        self.add_projected_tick(projected, semantic_digest, projection_duration)
    }

    fn add_projected_tick(
        &mut self,
        projected: Value,
        semantic_digest: [u8; 32],
        projection_duration: Duration,
    ) -> Result<(), Box<dyn Error>> {
        if self.tick_count >= MAX_TICKS {
            return Err("viewer replay tick count exceeds the pinned limit".into());
        }
        self.projection_duration += projection_duration;
        let hash_started = Instant::now();
        self.pending_tick_hasher.update(&projected)?;
        self.tick_hash_duration_ms += hash_started.elapsed().as_millis();
        self.pending.push(projected);
        self.pending_semantic_digests.push(semantic_digest);
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
        let expected_semantic_sha256 = semantic_tick_hash(&self.pending_semantic_digests);
        let encoded = encode_chunk(&self.pending, first_tick)?;
        self.encode_duration_ms += started.elapsed().as_millis();

        let expected_tick_sha256 =
            std::mem::replace(&mut self.pending_tick_hasher, TickHasher::new()).finish();

        let index = self.dispatched_chunks;
        let tick_count = self.pending.len();
        self.raw_chunk_bytes = self
            .raw_chunk_bytes
            .checked_add(encoded.len() as u64)
            .ok_or("viewer raw chunk byte count overflow")?;
        if self.raw_chunk_bytes > MAX_UNCOMPRESSED_BYTES {
            return Err("viewer chunks exceed the uncompressed size limit".into());
        }
        self.pending.clear();
        self.pending_semantic_digests.clear();
        self.task_sender
            .as_ref()
            .ok_or("viewer chunk workers are already closed")?
            .send(ChunkTask {
                directory: self.directory.clone(),
                index,
                first_tick,
                tick_count,
                raw: encoded,
                expected_tick_sha256,
                expected_semantic_sha256,
            })
            .map_err(|_| "viewer chunk worker queue closed unexpectedly")?;
        self.dispatched_chunks += 1;
        self.collect_ready_results()?;
        Ok(())
    }

    fn absorb_result(&mut self, result: ChunkWorkMessage) -> Result<(), Box<dyn Error>> {
        let result = result.map_err(|error| format!("viewer chunk worker failed: {error}"))?;
        self.validation_duration_ms += result.validation_duration_ms;
        self.compression_duration_ms += result.compression_duration_ms;
        self.chunk_write_duration_ms += result.chunk_write_duration_ms;
        self.compressed_chunk_bytes = self
            .compressed_chunk_bytes
            .checked_add(result.part.compressed_bytes as u64)
            .ok_or("viewer compressed chunk byte count overflow")?;
        if self.compressed_chunk_bytes > MAX_ARTIFACT_BYTES {
            return Err("viewer chunks exceed the artifact size limit".into());
        }
        self.chunks.push(result.part);
        Ok(())
    }

    fn collect_ready_results(&mut self) -> Result<(), Box<dyn Error>> {
        while let Ok(result) = self.result_receiver.try_recv() {
            self.absorb_result(result)?;
        }
        Ok(())
    }

    fn finish_workers(&mut self) -> Result<(), Box<dyn Error>> {
        self.task_sender.take();
        while self.chunks.len() < self.dispatched_chunks {
            let result = self
                .result_receiver
                .recv()
                .map_err(|_| "viewer chunk workers stopped before completing all chunks")?;
            self.absorb_result(result)?;
        }
        for handle in self.worker_handles.drain(..) {
            handle.join().map_err(|_| "viewer chunk worker panicked")?;
        }
        self.chunks.sort_by_key(|chunk| chunk.index);
        for (index, chunk) in self.chunks.iter().enumerate() {
            if chunk.index != index {
                return Err("viewer chunk workers returned an invalid sequence".into());
            }
        }
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
        let projection_started = Instant::now();
        let projection = projection()?;
        let mut replay = Map::new();
        for (key, node) in &projection.root_fields {
            if matches!(key.as_str(), "artifact" | "ticks") {
                continue;
            }
            if let Some(value) = source.get(key).filter(|value| !value.is_null()) {
                replay.insert(key.clone(), projection.project(node, value)?);
            }
        }
        self.projection_duration += projection_started.elapsed();
        self.finish_workers()?;
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
            "producer": "rust-serde_json-native-container",
            "metrics": {
                "projectionDurationMs": self.projection_duration.as_millis(),
                "encodeDurationMs": self.encode_duration_ms,
                "tickHashDurationMs": self.tick_hash_duration_ms,
                "validationDurationMs": self.validation_duration_ms,
                "compressionDurationMs": self.compression_duration_ms,
                "chunkWriteDurationMs": self.chunk_write_duration_ms,
                "nativeViewerDurationMs": self.started.elapsed().as_millis(),
                "rawChunkBytes": self.raw_chunk_bytes,
                "compressedChunkBytes": self.compressed_chunk_bytes,
                "workerCount": self.worker_count,
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

pub fn add_projected_tick(
    projected: Value,
    semantic_digest: [u8; 32],
    projection_duration: Duration,
) -> Result<(), Box<dyn Error>> {
    if let Some(viewer) = writer()
        .lock()
        .map_err(|_| "viewer writer lock is poisoned")?
        .as_mut()
    {
        viewer.add_projected_tick(projected, semantic_digest, projection_duration)?;
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct SourceContract {
    schema: String,
    profile: String,
    profile_revision: u32,
    projection_sha256: String,
    tick_count: usize,
}

impl SourceContract {
    fn validate(&self, tick_count: usize) -> Result<(), Box<dyn Error>> {
        if self.schema != VIEWER_SCHEMA
            || self.profile != VIEWER_PROFILE
            || self.profile_revision != VIEWER_PROFILE_REVISION
            || self.projection_sha256 != VIEWER_PROJECTION_SHA256
            || self.tick_count != tick_count
        {
            return Err("viewer parts source contract is invalid".into());
        }
        Ok(())
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartsMetrics {
    #[serde(default)]
    projection_duration_ms: u64,
    #[serde(default)]
    encode_duration_ms: u64,
    #[serde(default)]
    tick_hash_duration_ms: u64,
    #[serde(default)]
    validation_duration_ms: u64,
    #[serde(default)]
    compression_duration_ms: u64,
    #[serde(default)]
    chunk_write_duration_ms: u64,
    #[serde(default)]
    native_viewer_duration_ms: u64,
    #[serde(default)]
    raw_chunk_bytes: u64,
    #[serde(default)]
    compressed_chunk_bytes: u64,
    #[serde(default)]
    worker_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartsDescriptor {
    schema: String,
    source_contract: SourceContract,
    tick_count: usize,
    replay: Map<String, Value>,
    chunks: Vec<ChunkPart>,
    producer: String,
    #[serde(default)]
    metrics: PartsMetrics,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestChunk {
    index: usize,
    offset: u64,
    first_tick: usize,
    tick_count: usize,
    raw_bytes: usize,
    compressed_bytes: usize,
    compressed_sha256: String,
    tick_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerManifest {
    format: String,
    source_contract: SourceContract,
    replay_id: String,
    recorded_at: String,
    keyframe_interval: usize,
    tick_count: usize,
    chunks: Vec<ManifestChunk>,
    replay: Map<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerResult {
    schema: &'static str,
    sha256: String,
    size_bytes: u64,
    uncompressed_size_bytes: u64,
    tick_count: usize,
    chunk_count: usize,
    manifest_raw_bytes: usize,
    manifest_compressed_bytes: usize,
    assembly_duration_ms: u128,
    source_projection_duration_ms: u64,
    chunk_encode_duration_ms: u64,
    tick_hash_duration_ms: u64,
    validation_duration_ms: u64,
    compression_duration_ms: u64,
    chunk_write_duration_ms: u64,
    native_viewer_duration_ms: u64,
    worker_count: u64,
}

fn safe_child_path(directory: &Path, filename: &str) -> Result<PathBuf, Box<dyn Error>> {
    let candidate = Path::new(filename);
    if filename.is_empty()
        || candidate.is_absolute()
        || candidate.components().count() != 1
        || candidate.file_name().and_then(|value| value.to_str()) != Some(filename)
    {
        return Err("viewer parts filename is unsafe".into());
    }
    Ok(directory.join(candidate))
}

fn sha256_file(path: &Path) -> Result<String, Box<dyn Error>> {
    let mut reader = BufReader::with_capacity(COPY_BUFFER_BYTES, File::open(path)?);
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest_hex(digest.finalize()))
}

fn validate_parts(parts: &PartsDescriptor, directory: &Path) -> Result<(u64, u64), Box<dyn Error>> {
    if parts.schema != PARTS_SCHEMA
        || parts.producer != "rust-serde_json-native-container"
        || !(1..=MAX_TICKS).contains(&parts.tick_count)
    {
        return Err("viewer parts descriptor is invalid".into());
    }
    parts.source_contract.validate(parts.tick_count)?;
    let mut expected_first_tick = 0_usize;
    let mut raw_bytes = 0_u64;
    let mut compressed_bytes = 0_u64;
    for (expected_index, chunk) in parts.chunks.iter().enumerate() {
        if chunk.index != expected_index
            || chunk.first_tick != expected_first_tick
            || !(1..=KEYFRAME_INTERVAL).contains(&chunk.tick_count)
            || chunk.raw_bytes == 0
            || chunk.compressed_bytes == 0
            || chunk.compressed_sha256.len() != 64
            || chunk.tick_sha256.len() != 64
        {
            return Err("viewer parts chunk sequence is invalid".into());
        }
        let path = safe_child_path(directory, &chunk.compressed_file)?;
        if fs::metadata(&path)?.len() != chunk.compressed_bytes as u64
            || sha256_file(&path)? != chunk.compressed_sha256
        {
            return Err("viewer compressed chunk changed before finalization".into());
        }
        expected_first_tick = expected_first_tick
            .checked_add(chunk.tick_count)
            .ok_or("viewer tick coverage overflow")?;
        raw_bytes = raw_bytes
            .checked_add(chunk.raw_bytes as u64)
            .ok_or("viewer raw byte count overflow")?;
        compressed_bytes = compressed_bytes
            .checked_add(chunk.compressed_bytes as u64)
            .ok_or("viewer compressed byte count overflow")?;
    }
    if expected_first_tick != parts.tick_count
        || raw_bytes != parts.metrics.raw_chunk_bytes
        || compressed_bytes != parts.metrics.compressed_chunk_bytes
    {
        return Err("viewer parts coverage or metrics are invalid".into());
    }
    Ok((raw_bytes, compressed_bytes))
}

fn validate_manifest(
    manifest: &ViewerManifest,
    parts: &PartsDescriptor,
) -> Result<(), Box<dyn Error>> {
    if manifest.format != VIEWER_DELTA_FORMAT
        || manifest.replay_id.trim().is_empty()
        || manifest.recorded_at.trim().is_empty()
        || manifest.keyframe_interval != KEYFRAME_INTERVAL
        || manifest.tick_count != parts.tick_count
        || manifest.source_contract != parts.source_contract
        || manifest.chunks.len() != parts.chunks.len()
        || !deep_exact_equal(
            &Value::Object(manifest.replay.clone()),
            &Value::Object(parts.replay.clone()),
        )
    {
        return Err("viewer manifest does not match its native parts".into());
    }
    let mut expected_offset = 0_u64;
    for (manifest_chunk, part) in manifest.chunks.iter().zip(&parts.chunks) {
        if manifest_chunk.index != part.index
            || manifest_chunk.offset != expected_offset
            || manifest_chunk.first_tick != part.first_tick
            || manifest_chunk.tick_count != part.tick_count
            || manifest_chunk.raw_bytes != part.raw_bytes
            || manifest_chunk.compressed_bytes != part.compressed_bytes
            || manifest_chunk.compressed_sha256 != part.compressed_sha256
            || manifest_chunk.tick_sha256 != part.tick_sha256
        {
            return Err("viewer manifest chunk does not match its native part".into());
        }
        expected_offset = expected_offset
            .checked_add(part.compressed_bytes as u64)
            .ok_or("viewer manifest chunk offset overflow")?;
    }
    Ok(())
}

fn container_header(
    manifest_compressed_bytes: usize,
    manifest_raw_bytes: usize,
    total_bytes: u64,
) -> Result<[u8; CONTAINER_HEADER_BYTES], Box<dyn Error>> {
    let manifest_compressed_bytes = u32::try_from(manifest_compressed_bytes)?;
    let manifest_raw_bytes = u32::try_from(manifest_raw_bytes)?;
    let total_bytes = u32::try_from(total_bytes)?;
    let mut header = [0_u8; CONTAINER_HEADER_BYTES];
    header[..8].copy_from_slice(CONTAINER_MAGIC);
    header[8..10].copy_from_slice(&(CONTAINER_HEADER_BYTES as u16).to_le_bytes());
    header[10..12].copy_from_slice(&CONTAINER_VERSION.to_le_bytes());
    header[12..16].copy_from_slice(&MANIFEST_COMPRESSION.to_le_bytes());
    header[16..20].copy_from_slice(&manifest_compressed_bytes.to_le_bytes());
    header[20..24].copy_from_slice(&manifest_raw_bytes.to_le_bytes());
    header[24..28].copy_from_slice(&total_bytes.to_le_bytes());
    Ok(header)
}

pub fn finalize_container(
    directory: &Path,
    manifest_path: &Path,
    output_path: &Path,
) -> Result<ContainerResult, Box<dyn Error>> {
    let started = Instant::now();
    let parts: PartsDescriptor =
        serde_json::from_reader(BufReader::new(File::open(directory.join("parts.json"))?))?;
    let (raw_chunk_bytes, compressed_chunk_bytes) = validate_parts(&parts, directory)?;
    let manifest_raw = fs::read(manifest_path)?;
    let manifest: ViewerManifest = serde_json::from_slice(&manifest_raw)?;
    validate_manifest(&manifest, &parts)?;

    let compression_started = Instant::now();
    let mut compressor = zstd::bulk::Compressor::new(ZSTD_LEVEL)?;
    compressor.include_checksum(true)?;
    compressor.include_contentsize(true)?;
    let manifest_compressed = compressor.compress(&manifest_raw)?;
    let manifest_compression_ms = compression_started.elapsed().as_millis() as u64;
    if zstd::bulk::decompress(&manifest_compressed, manifest_raw.len())? != manifest_raw {
        return Err("viewer manifest compression changed bytes".into());
    }

    let size_bytes = (CONTAINER_HEADER_BYTES as u64)
        .checked_add(manifest_compressed.len() as u64)
        .and_then(|value| value.checked_add(compressed_chunk_bytes))
        .ok_or("viewer container byte count overflow")?;
    let uncompressed_size_bytes = (CONTAINER_HEADER_BYTES as u64)
        .checked_add(manifest_raw.len() as u64)
        .and_then(|value| value.checked_add(raw_chunk_bytes))
        .ok_or("viewer uncompressed byte count overflow")?;
    if size_bytes > MAX_ARTIFACT_BYTES || uncompressed_size_bytes > MAX_UNCOMPRESSED_BYTES {
        return Err("viewer container exceeds its pinned size limit".into());
    }
    let header = container_header(manifest_compressed.len(), manifest_raw.len(), size_bytes)?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial_path = output_path.with_extension("hsrv.partial");
    if partial_path.exists() {
        fs::remove_file(&partial_path)?;
    }
    let mut output = BufWriter::with_capacity(COPY_BUFFER_BYTES, File::create(&partial_path)?);
    let mut digest = Sha256::new();
    let mut written = 0_u64;
    for bytes in [&header[..], &manifest_compressed] {
        output.write_all(bytes)?;
        digest.update(bytes);
        written += bytes.len() as u64;
    }
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    for chunk in &parts.chunks {
        let path = safe_child_path(directory, &chunk.compressed_file)?;
        let mut source = BufReader::with_capacity(COPY_BUFFER_BYTES, File::open(path)?);
        loop {
            let read = source.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read])?;
            digest.update(&buffer[..read]);
            written = written
                .checked_add(read as u64)
                .ok_or("viewer output byte count overflow")?;
        }
    }
    output.flush()?;
    drop(output);
    if written != size_bytes || fs::metadata(&partial_path)?.len() != size_bytes {
        let _ = fs::remove_file(&partial_path);
        return Err("viewer container byte count changed during finalization".into());
    }
    if output_path.exists() {
        fs::remove_file(output_path)?;
    }
    fs::rename(&partial_path, output_path)?;

    Ok(ContainerResult {
        schema: CONTAINER_RESULT_SCHEMA,
        sha256: digest_hex(digest.finalize()),
        size_bytes,
        uncompressed_size_bytes,
        tick_count: parts.tick_count,
        chunk_count: parts.chunks.len(),
        manifest_raw_bytes: manifest_raw.len(),
        manifest_compressed_bytes: manifest_compressed.len(),
        assembly_duration_ms: started.elapsed().as_millis(),
        source_projection_duration_ms: parts.metrics.projection_duration_ms,
        chunk_encode_duration_ms: parts.metrics.encode_duration_ms,
        tick_hash_duration_ms: parts.metrics.tick_hash_duration_ms,
        validation_duration_ms: parts.metrics.validation_duration_ms,
        compression_duration_ms: parts
            .metrics
            .compression_duration_ms
            .saturating_add(manifest_compression_ms),
        chunk_write_duration_ms: parts.metrics.chunk_write_duration_ms,
        native_viewer_duration_ms: parts.metrics.native_viewer_duration_ms,
        worker_count: parts.metrics.worker_count,
    })
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
        let encoded = encode_chunk(&ticks, 7).expect("encode chunk");
        assert_eq!(encoded, expected);
        let semantic_digests = ticks
            .iter()
            .map(semantic_value_digest)
            .collect::<Result<Vec<_>, _>>()
            .expect("hash source semantics");
        let expected_semantic_hash = semantic_tick_hash(&semantic_digests);
        let (_, _, decoded_semantic_hash) =
            decode_chunk_semantic_hash(&encoded).expect("hash decoded semantics");
        assert_eq!(decoded_semantic_hash, expected_semantic_hash);
        let (first_tick, decoded) = decode_chunk(&encoded).expect("decode chunk");
        assert_eq!(first_tick, 7);
        assert!(
            decoded
                .iter()
                .zip(&ticks)
                .all(|(decoded, expected)| deep_exact_equal(decoded, expected))
        );
    }

    #[test]
    fn tick_hash_serialization_matches_json_stringify_numbers() {
        let value = serde_json::json!([
            -0.0,
            333_333_333.333_333_3,
            1e30,
            4.50,
            2e-3,
            1e-27,
            1e-6,
            1e-7,
            1e20,
            1e21,
        ]);
        let mut serialized = Vec::new();
        write_tick_json(&mut serialized, &value).expect("serialize tick hash JSON");
        assert_eq!(
            serialized,
            b"[0,333333333.3333333,1e+30,4.5,0.002,1e-27,0.000001,1e-7,100000000000000000000,1e+21]"
        );
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
