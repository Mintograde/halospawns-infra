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
        let length = self.u32()? as usize;
        if length > 65536 {
            return Err("engine string exceeds limit".into());
        }
        Ok(std::str::from_utf8(self.take(length)?)?.to_owned())
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
        let value = cursor.value(0)?;
        if !cursor.0.is_empty() || !value.is_object() {
            return Err("invalid engine frame root or trailing data".into());
        }
        Ok(Some(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
