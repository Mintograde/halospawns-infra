use super::*;

fn same(previous: &Value, next: &Value) -> bool {
    match (previous, next) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter().zip(b).all(|((key, a), (other, b_value))| {
                    if key == other {
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
    if float_delta::write(writer, previous, next, before)? {
        return Ok(());
    }
    if let Some(previous) = previous
        && same(previous, next)
    {
        writer.byte(DELTA_SAME);
        return Ok(());
    }
    if let (Some(Value::Object(a)), Value::Object(b)) = (previous, next)
        && a.len() == b.len()
        && a.len() <= 64
        && a.keys().eq(b.keys())
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
                write(writer, Some(a), b, history.and_then(|v| v.get(key)))?;
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
            for (i, b) in b.iter().enumerate() {
                write(writer, a.get(i), b, history.and_then(|v| v.get(i)))?;
            }
        } else {
            writer.byte(DELTA_ARRAY);
            writer.varuint(b.len() as u64)?;
            writer.varuint(changed.len() as u64)?;
            for i in changed {
                writer.varuint(i as u64)?;
                write(writer, a.get(i), &b[i], history.and_then(|v| v.get(i)))?;
            }
        }
        return Ok(());
    }
    write_delta(writer, previous, next, before)
}

#[cfg(test)]
mod tests {
    use super::*;

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
