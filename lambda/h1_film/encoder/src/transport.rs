use serde_json::{Map, Number, Value};
use std::error::Error;
use std::io::Read;

pub const MAX_FRAME: usize = 4 * 1024 * 1024;
type Result<T> = std::result::Result<T, Box<dyn Error>>;

struct Cursor<'a>(&'a [u8]);
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
            _ => return Err("unknown engine transport tag".into()),
        })
    }

    fn reuse(&mut self, target: &mut Value, depth: usize) -> Result<()> {
        if depth >= 32 {
            return Err("engine record exceeds nesting limit".into());
        }
        let tag = *self.0.first().ok_or("truncated engine record")?;
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
            let start = self.0;
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
                self.0 = start;
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
}

pub struct Stream<R> {
    input: R,
    buffer: Vec<u8>,
    pub bytes: u64,
}
impl<R: Read> Stream<R> {
    pub fn new(mut input: R) -> Result<Self> {
        let mut magic = [0; 8];
        input.read_exact(&mut magic)?;
        if &magic != b"HSFT0001" {
            return Err("not an H1 binary tick stream".into());
        }
        Ok(Self {
            input,
            buffer: Vec::new(),
            bytes: 8,
        })
    }
    pub fn next(&mut self) -> Result<Option<Value>> {
        self.next_reusing(Value::Null)
    }
    pub fn next_reusing(&mut self, mut value: Value) -> Result<Option<Value>> {
        let mut length = [0; 4];
        if self.input.read(&mut length[..1])? == 0 {
            return Ok(None);
        }
        self.input.read_exact(&mut length[1..])?;
        let size = u32::from_le_bytes(length) as usize;
        if !(5..=MAX_FRAME).contains(&size) {
            return Err("invalid engine frame length".into());
        }
        self.buffer.resize(size, 0);
        self.input.read_exact(&mut self.buffer)?;
        self.bytes += 4 + size as u64;
        let mut cursor = Cursor(&self.buffer);
        cursor.reuse(&mut value, 0)?;
        if !cursor.0.is_empty() || !value.is_object() {
            return Err("invalid engine frame root or trailing data".into());
        }
        Ok(Some(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(value: &Value, bytes: &mut Vec<u8>) {
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
                bytes.push(3);
                bytes.extend_from_slice(&(value.as_i64().unwrap() as i32).to_le_bytes());
            }
            Value::String(value) => {
                bytes.push(7);
                text(value, bytes);
            }
            Value::Array(values) => {
                bytes.push(8);
                bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
                for value in values {
                    encode(value, bytes);
                }
            }
            Value::Object(values) => {
                bytes.push(9);
                bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
                for (key, value) in values {
                    text(key, bytes);
                    encode(value, bytes);
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
            let fresh = Cursor(&bytes).value(0).unwrap();
            let mut cursor = Cursor(&bytes);
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
            assert!(Cursor(&bytes).value(0).is_err());
            for mut target in [
                Value::Null,
                serde_json::json!("old"),
                serde_json::json!([1]),
                serde_json::json!({"a": 1, "b": 2}),
            ] {
                assert!(Cursor(&bytes).reuse(&mut target, 0).is_err());
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
            let expected = Cursor(&bytes).value(depth).unwrap();
            let mut target = serde_json::json!([{"old": 1}]);
            let mut cursor = Cursor(&bytes);
            cursor.reuse(&mut target, depth).unwrap();
            assert!(cursor.0.is_empty());
            assert_eq!(
                serde_json::to_vec(&target).unwrap(),
                serde_json::to_vec(&expected).unwrap()
            );
        }
        let mut target = serde_json::json!([1]);
        assert!(Cursor(&bytes).reuse(&mut target, 31).is_err());
        for length in 0..bytes.len() {
            let mut target = serde_json::json!([1]);
            assert!(Cursor(&bytes[..length]).reuse(&mut target, 0).is_err());
        }
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut bytes = vec![8, 1, 0, 0, 0, 6];
            bytes.extend_from_slice(&value.to_le_bytes());
            let mut target = serde_json::json!([1]);
            assert!(Cursor(&bytes).reuse(&mut target, 0).is_err());
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
        let value = Cursor(&raw).value(0).unwrap();
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
            assert!(Cursor(input).value(0).is_err());
        }
    }
    #[test]
    fn truncated_frames_are_rejected() {
        let raw = b"HSFT0001\x08\0\0\0\x09\0\0\0\0";
        assert!(Stream::new(&raw[..]).unwrap().next().is_err());
        assert!(Stream::new(&b"HSFT0001\x08"[..]).unwrap().next().is_err());
    }
}
