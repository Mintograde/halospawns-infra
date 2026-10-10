use ahash::AHashMap;
use serde_json::Value;
use std::error::Error;

pub enum Validator {
    Null,
    Boolean,
    Number {
        minimum: f64,
        maximum: f64,
        integer: bool,
    },
    String {
        minimum: usize,
        maximum: usize,
    },
    Array {
        minimum: usize,
        maximum: usize,
        items: Box<Self>,
    },
    Object {
        minimum: usize,
        maximum: usize,
        fields: AHashMap<String, Self>,
        required: Vec<String>,
        additional: Box<Self>,
    },
    OneOf(Vec<Self>),
    Any(bool),
    Reference(jsonschema::Validator),
}

impl Validator {
    pub fn for_revision(revision: u32) -> Result<Self, Box<dyn Error>> {
        let document: Value = serde_json::from_str(match revision {
            1 => include_str!(
                "../../../replay_parser/contracts/replays/halospawns.viewerReplay.v1.schema.json"
            ),
            2 => include_str!(
                "../../../replay_parser/contracts/replays/halospawns.viewerReplay.v1.frontend-default.v2.schema.json"
            ),
            3 => include_str!(
                "../../../replay_parser/contracts/replays/halospawns.viewerReplay.v1.frontend-default.v3.schema.json"
            ),
            _ => return Err("unsupported viewer schema revision".into()),
        })?;
        Self::compile(&document["$defs"]["tick"], &document, 0)
    }

    fn compile(schema: &Value, document: &Value, depth: usize) -> Result<Self, Box<dyn Error>> {
        if depth > 32 {
            return Err("viewer schema nesting limit".into());
        }
        let fallback = || -> Result<Self, Box<dyn Error>> {
            let mut schema = schema.clone();
            schema["$defs"] = document["$defs"].clone();
            Ok(Self::Reference(jsonschema::validator_for(&schema)?))
        };
        if let Some(value) = schema.as_bool() {
            return Ok(Self::Any(value));
        }
        let keys: Vec<_> = schema
            .as_object()
            .ok_or("invalid viewer schema")?
            .keys()
            .map(String::as_str)
            .filter(|key| !matches!(*key, "description" | "title"))
            .collect();
        if keys == ["$ref"] {
            let name = schema["$ref"]
                .as_str()
                .and_then(|v| v.strip_prefix("#/$defs/"))
                .ok_or("unsupported schema reference")?;
            return Self::compile(
                document["$defs"]
                    .get(name)
                    .ok_or("unknown schema reference")?,
                document,
                depth + 1,
            );
        }
        if keys == ["oneOf"] {
            return Ok(Self::OneOf(
                schema["oneOf"]
                    .as_array()
                    .ok_or("invalid oneOf")?
                    .iter()
                    .map(|child| Self::compile(child, document, depth + 1))
                    .collect::<Result<_, _>>()?,
            ));
        }
        let allowed: &[&str] = match schema["type"].as_str() {
            Some("null" | "boolean") => &["type"],
            Some("number" | "integer") => &["type", "minimum", "maximum"],
            Some("string") => &["type", "minLength", "maxLength"],
            Some("array") => &["type", "minItems", "maxItems", "items"],
            Some("object") => &[
                "type",
                "minProperties",
                "maxProperties",
                "properties",
                "required",
                "additionalProperties",
            ],
            _ => return fallback(),
        };
        // Unhandled constraints keep the authoritative validator, including
        // patterns, propertyNames, and any future schema keywords.
        if keys.iter().any(|key| !allowed.contains(key)) {
            return fallback();
        }
        let bound = |key: &str, default| schema[key].as_u64().map_or(default, |v| v as usize);
        Ok(match schema["type"].as_str().unwrap() {
            "null" => Self::Null,
            "boolean" => Self::Boolean,
            "number" | "integer" => Self::Number {
                minimum: schema["minimum"].as_f64().unwrap_or(f64::NEG_INFINITY),
                maximum: schema["maximum"].as_f64().unwrap_or(f64::INFINITY),
                integer: schema["type"] == "integer",
            },
            "string" => Self::String {
                minimum: bound("minLength", 0),
                maximum: bound("maxLength", usize::MAX),
            },
            "array" => Self::Array {
                minimum: bound("minItems", 0),
                maximum: bound("maxItems", usize::MAX),
                items: Box::new(
                    schema
                        .get("items")
                        .map(|v| Self::compile(v, document, depth + 1))
                        .transpose()?
                        .unwrap_or(Self::Any(true)),
                ),
            },
            "object" => Self::Object {
                minimum: bound("minProperties", 0),
                maximum: bound("maxProperties", usize::MAX),
                fields: schema
                    .get("properties")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                    .map(|(key, child)| {
                        Ok((key.clone(), Self::compile(child, document, depth + 1)?))
                    })
                    .collect::<Result<_, Box<dyn Error>>>()?,
                required: schema
                    .get("required")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|v| {
                        v.as_str()
                            .map(str::to_owned)
                            .ok_or("invalid required field".into())
                    })
                    .collect::<Result<_, Box<dyn Error>>>()?,
                additional: Box::new(
                    schema
                        .get("additionalProperties")
                        .map(|v| Self::compile(v, document, depth + 1))
                        .transpose()?
                        .unwrap_or(Self::Any(true)),
                ),
            },
            _ => unreachable!(),
        })
    }

    pub fn is_valid(&self, value: &Value) -> bool {
        match self {
            Self::Null => value.is_null(),
            Self::Boolean => value.is_boolean(),
            Self::Number {
                minimum,
                maximum,
                integer,
            } => value
                .as_f64()
                .is_some_and(|v| v >= *minimum && v <= *maximum && (!integer || v.fract() == 0.0)),
            Self::String { minimum, maximum } => value.as_str().is_some_and(|s| {
                if *minimum == 0 && s.len() <= *maximum {
                    return true;
                }
                let count = s.chars().count();
                (*minimum..=*maximum).contains(&count)
            }),
            Self::Array {
                minimum,
                maximum,
                items,
            } => value.as_array().is_some_and(|values| {
                (*minimum..=*maximum).contains(&values.len())
                    && values.iter().all(|v| items.is_valid(v))
            }),
            Self::Object {
                minimum,
                maximum,
                fields,
                required,
                additional,
            } => value.as_object().is_some_and(|values| {
                (*minimum..=*maximum).contains(&values.len())
                    && required.iter().all(|key| values.contains_key(key))
                    && values
                        .iter()
                        .all(|(key, value)| fields.get(key).unwrap_or(additional).is_valid(value))
            }),
            Self::OneOf(choices) => {
                choices.iter().filter(|v| v.is_valid(value)).take(2).count() == 1
            }
            Self::Any(accept) => *accept,
            Self::Reference(validator) => validator.is_valid(value),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_definition_matches_reference_at_type_and_numeric_boundaries() {
        for text in [
            include_str!(
                "../../../replay_parser/contracts/replays/halospawns.viewerReplay.v1.schema.json"
            ),
            include_str!(
                "../../../replay_parser/contracts/replays/halospawns.viewerReplay.v1.frontend-default.v2.schema.json"
            ),
            include_str!(
                "../../../replay_parser/contracts/replays/halospawns.viewerReplay.v1.frontend-default.v3.schema.json"
            ),
        ] {
            let document: Value = serde_json::from_str(text).unwrap();
            let mut cases = vec![
                Value::Null,
                json!(true),
                json!(false),
                json!([]),
                json!({}),
                json!([null]),
                json!([0.0]),
                json!({"unknown":1}),
                json!(""),
                json!("a"),
                json!("0:00:00"),
                json!("0:99:00"),
                json!("0"),
                json!("01"),
            ];
            for size in [1, 32, 64, 128, 256, 512, 2048, 2049] {
                cases.push(json!("a".repeat(size)));
                cases.push(json!("\u{00e9}".repeat(size)));
            }
            for bound in [
                -4294967296.0,
                -2147483648.0,
                -1e9,
                -32768.0,
                -1.0,
                -0.0,
                0.0,
                1.0,
                3.0,
                127.0,
                32767.0,
                1e9,
                4294967295.0,
                3.4028234663852886e38,
            ] {
                for delta in [-1.0, -0.5, 0.0, 0.5, 1.0] {
                    cases.push(json!(bound + delta));
                }
            }
            for (name, schema) in document["$defs"].as_object().unwrap() {
                let fast = Validator::compile(schema, &document, 0).unwrap();
                let reference = jsonschema::validator_for(
                    &json!({"$defs":document["$defs"],"$ref":format!("#/$defs/{name}")}),
                )
                .unwrap();
                for value in &cases {
                    assert_eq!(
                        fast.is_valid(value),
                        reference.is_valid(value),
                        "{name}: {value}"
                    );
                }
                if let Some(properties) = schema["properties"].as_object() {
                    for key in properties.keys() {
                        for value in &cases {
                            let object = json!({key:value});
                            assert_eq!(
                                fast.is_valid(&object),
                                reference.is_valid(&object),
                                "{name}.{key}: {value}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn unhandled_constraints_and_reference_siblings_keep_the_reference_validator() {
        let document = json!({"$defs":{"number":{"type":"number"}}});
        for schema in [
            json!({"type":"integer","multipleOf":3}),
            json!({"$ref":"#/$defs/number","maximum":3}),
            json!({"type":"object","required":["x"],"propertyNames":{"pattern":"^x$"}}),
            json!({"oneOf":[{"type":"number"},{"type":"integer"}]}),
        ] {
            let fast = Validator::compile(&schema, &document, 0).unwrap();
            let mut full = schema.clone();
            full["$defs"] = document["$defs"].clone();
            let reference = jsonschema::validator_for(&full).unwrap();
            for value in [
                json!(0),
                json!(3),
                json!(4),
                json!(1.5),
                json!({}),
                json!({"x":null}),
                json!({"y":0}),
            ] {
                assert_eq!(fast.is_valid(&value), reference.is_valid(&value));
            }
        }
    }

    #[test]
    fn nested_tick_mutations_match_the_reference_validator() {
        fn paths(value: &Value, prefix: String, out: &mut Vec<String>) {
            out.push(prefix.clone());
            match value {
                Value::Array(values) => {
                    for (index, value) in values.iter().enumerate() {
                        paths(value, format!("{prefix}/{index}"), out);
                    }
                }
                Value::Object(values) => {
                    for (key, value) in values {
                        paths(
                            value,
                            format!("{prefix}/{}", key.replace('~', "~0").replace('/', "~1")),
                            out,
                        );
                    }
                }
                _ => {}
            }
        }
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../replay_parser/tests/fixtures/replays/viewer_v2_first_person_canonical.json"
        ))
        .unwrap();
        let document: Value = serde_json::from_str(include_str!("../../../replay_parser/contracts/replays/halospawns.viewerReplay.v1.frontend-default.v2.schema.json")).unwrap();
        let reference =
            jsonschema::validator_for(&json!({"$defs":document["$defs"],"$ref":"#/$defs/tick"}))
                .unwrap();
        let fast = Validator::for_revision(2).unwrap();
        for tick in fixture["ticks"].as_array().unwrap() {
            assert_eq!(fast.is_valid(tick), reference.is_valid(tick));
            let mut locations = Vec::new();
            paths(tick, String::new(), &mut locations);
            for path in locations {
                for value in [
                    Value::Null,
                    json!(true),
                    json!(false),
                    json!(-0.0),
                    json!(0.5),
                    json!(-2147483649_i64),
                    json!(4294967296_u64),
                    json!(-3.402823466385289e38),
                    json!(""),
                    json!("invalid"),
                    json!("\u{00e9}".repeat(2049)),
                    json!([]),
                    json!({}),
                    json!(vec![Value::Null; 65]),
                    json!({"unexpected":true}),
                ] {
                    let mut mutated = tick.clone();
                    *mutated.pointer_mut(&path).unwrap() = value;
                    assert_eq!(
                        fast.is_valid(&mutated),
                        reference.is_valid(&mutated),
                        "path {path}"
                    );
                }
            }
        }
    }
}
