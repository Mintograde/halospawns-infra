use super::*;

pub(super) fn same(previous: &Value, next: &Value) -> bool {
    match (previous, next) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter().zip(b).all(|((key, a), (other, b_value))| {
                    if crate::text_equal::equal(key, other) {
                        same(a, b_value)
                    } else {
                        b.get(key).is_some_and(|b| same(a, b))
                    }
                })
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        _ => same_scalar(previous, next),
    }
}

// Projected objects normally have identical contract field order. In that case
// compare aligned slots instead of hashing every key several times. All other
// shapes and the numerical encodings retain the shared codec as their oracle.
pub(super) fn write(
    writer: &mut BinaryWriter,
    previous: Option<&Value>,
    next: &Value,
    before: Option<&Value>,
) -> Result<(), Box<dyn Error>> {
    write_inner(writer, previous, next, before, false)
}

pub(super) fn write_inner(
    writer: &mut BinaryWriter,
    previous: Option<&Value>,
    next: &Value,
    before: Option<&Value>,
    changed_known: bool,
) -> Result<(), Box<dyn Error>> {
    if let (Some(previous), Some(next)) = (previous.and_then(number), number(next)) {
        if !changed_known && previous.to_bits() == next.to_bits() {
            writer.byte(DELTA_SAME);
            return Ok(());
        }
        let history = before.and_then(number);
        if COMPACT_WORLD.get() != Some(&true)
            || !write_compact_number(writer, previous, next, history)?
        {
            write_number_delta(writer, previous, next, history)?;
        }
        return Ok(());
    }
    if float_delta::write(writer, previous, next, before)? {
        return Ok(());
    }
    if !changed_known
        && let Some(previous) = previous
        && same(previous, next)
    {
        writer.byte(DELTA_SAME);
        return Ok(());
    }
    if let (Some(Value::Object(a)), Value::Object(b)) = (previous, next)
        && a.len() == b.len()
        && a.len() <= 64
        && a.keys()
            .zip(b.keys())
            .all(|(key, other)| crate::text_equal::equal(key, other))
    {
        let mut changed = 0u64;
        for (i, (a, b)) in a.values().zip(b.values()).enumerate() {
            if !same(a, b) {
                changed |= 1 << i;
            }
        }
        writer.byte(DELTA_OBJECT);
        writer.varuint(0)?;
        writer.varuint(changed.count_ones().into())?;
        let history = before.and_then(Value::as_object);
        for (i, ((key, b), a)) in b.iter().zip(a.values()).enumerate() {
            if changed & (1 << i) != 0 {
                writer.string(key)?;
                write_inner(writer, Some(a), b, history.and_then(|v| v.get(key)), true)?;
            }
        }
        return Ok(());
    }
    if let (Some(Value::Array(a)), Value::Array(b)) = (previous, next)
        && !(a.len() == b.len()
            && !b.is_empty()
            && exact_float32_array(a)
            && exact_float32_array(b))
    {
        let changed: Vec<_> = b
            .iter()
            .enumerate()
            .filter(|(i, b)| a.get(*i).is_none_or(|a| !same(a, b)))
            .map(|(i, _)| i)
            .collect();
        let history = before.and_then(Value::as_array);
        if a.len() == b.len() && changed.len() > b.len() / 2 {
            writer.byte(DELTA_DENSE_ARRAY);
            let mut changed = changed.into_iter().peekable();
            for (i, b) in b.iter().enumerate() {
                if changed.peek() == Some(&i) {
                    changed.next();
                    write_inner(writer, a.get(i), b, history.and_then(|v| v.get(i)), true)?;
                } else {
                    writer.byte(DELTA_SAME);
                }
            }
        } else {
            writer.byte(DELTA_ARRAY);
            writer.varuint(b.len() as u64)?;
            writer.varuint(changed.len() as u64)?;
            for i in changed {
                writer.varuint(i as u64)?;
                write_inner(
                    writer,
                    a.get(i),
                    &b[i],
                    history.and_then(|v| v.get(i)),
                    true,
                )?;
            }
        }
        return Ok(());
    }
    write_delta(writer, previous, next, before)
}

// Most moving coordinates have either a small linear residual or repeat an
// absolute float elsewhere in the chunk. Stable tags let zstd match those runs.
fn write_compact_number(
    writer: &mut BinaryWriter,
    previous: f64,
    next: f64,
    before: Option<f64>,
) -> Result<bool, Box<dyn Error>> {
    if !exact_f32(previous) || !exact_f32(next) || (previous.fract() == 0.0 && next.fract() == 0.0)
    {
        return Ok(false);
    }
    let next_bits = (next as f32).to_bits();
    let residual = |prediction| signed_difference(signed_uint32_difference(prediction, next_bits));
    const MAX_RESIDUAL: u64 = (1 << 17) - 1;
    let predicted = before
        .filter(|value| exact_f32(*value))
        .map(|value| residual(predict_value_bits(value, previous)));
    if let Some(value) = predicted.filter(|value| *value <= MAX_RESIDUAL) {
        writer.byte(DELTA_FLOAT32_VALUE_PREDICTION);
        writer.varuint(value)?;
    } else {
        let value = residual((previous as f32).to_bits());
        if value <= MAX_RESIDUAL {
            writer.byte(DELTA_FLOAT32_DIFFERENCE);
            writer.varuint(value)?;
        } else {
            writer.byte(DELTA_REPLACE);
            write_number(writer, next)?;
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_coordinates_decode_to_the_exact_original_bits() {
        for (before, previous, next, tag) in [
            (Some(1.0), 1.125, 1.25, Some(DELTA_FLOAT32_VALUE_PREDICTION)),
            (
                None,
                1.5,
                f32::from_bits(1.5_f32.to_bits() + 1) as f64,
                Some(DELTA_FLOAT32_DIFFERENCE),
            ),
            (None, 1.5, -100.25, Some(DELTA_REPLACE)),
            (Some(4.0), 1.5, -0.0, Some(DELTA_REPLACE)),
            (None, -0.0, 0.0, None),
            (None, 1024.0, 2048.0, None),
            (Some(0.1), 0.2, 0.3, None),
            (
                None,
                f32::MIN_POSITIVE as f64,
                f32::from_bits(1) as f64,
                Some(DELTA_REPLACE),
            ),
        ] {
            let mut writer = BinaryWriter::new();
            let encoded = write_compact_number(&mut writer, previous, next, before).unwrap();
            assert_eq!(encoded, tag.is_some());
            if let Some(tag) = tag {
                assert_eq!(writer.bytes[0], tag);
            } else {
                write_number_delta(&mut writer, previous, next, before).unwrap();
            }
            let mut reader = BinaryReader::new(&writer.bytes);
            let value = read_patched_value(
                &mut reader,
                Some(&DecodedValue::Number(previous)),
                before.map(DecodedValue::Number).as_ref(),
                1,
            )
            .unwrap();
            assert_eq!(value.number().unwrap().to_bits(), next.to_bits());
            assert_eq!(reader.offset, writer.bytes.len());
        }
    }

    #[test]
    fn specialization_preserves_bytes_for_dense_sparse_reordered_and_changing_shapes() {
        let mut ticks = Vec::new();
        for i in 0..300 {
            let mut object = Map::new();
            for j in (0..70).filter(|j| i % 3 != 0 || j % 7 != 0) {
                object.insert(
                    j.to_string(),
                    serde_json::json!([i % 5, j, (i as f32 * 0.125).sin(), -0.0]),
                );
            }
            if i % 5 == 0 {
                object.sort_keys();
            }
            ticks.push(serde_json::json!({"objects":[object], "players":(0..(i%12)).map(|j|
                serde_json::json!({"id":j,"position":[j as f32, i as f32, -0.0],"name":"same"})).collect::<Vec<_>>(),
                "small":{"x":i/4, "y":i%2==0}, "empty":[], "null":null}));
        }
        let mut reference = BinaryWriter::new();
        let mut optimized = BinaryWriter::new();
        for (i, tick) in ticks.iter().enumerate() {
            let previous = i.checked_sub(1).map(|i| &ticks[i]);
            let before = i.checked_sub(2).map(|i| &ticks[i]);
            write_delta(&mut reference, previous, tick, before).unwrap();
            write(&mut optimized, previous, tick, before).unwrap();
            assert_eq!(optimized.bytes, reference.bytes, "tick {i}");
        }
    }
}
