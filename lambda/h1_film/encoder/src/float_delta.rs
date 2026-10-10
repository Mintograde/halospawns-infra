use super::*;

// The viewer's exact float32 modes and tie ordering are unchanged. Collect
// numbers once and evaluate all predictors together, without repeated JSON walks.
pub(super) fn write(
    writer: &mut BinaryWriter,
    previous: Option<&Value>,
    next: &Value,
    before: Option<&Value>,
) -> Result<bool, Box<dyn Error>> {
    let (Some(Value::Array(previous)), Value::Array(next)) = (previous, next) else {
        return Ok(false);
    };
    let count = next.len();
    if count == 0 || count > 64 || previous.len() != count {
        return Ok(false);
    }
    let mut numbers = [0.0; 64];
    let mut old_bits = [0u32; 64];
    let mut new_bits = [0u32; 64];
    let mut same = true;
    for i in 0..count {
        let (Some(a), Some(b)) = (number(&previous[i]), number(&next[i])) else {
            return Ok(false);
        };
        if !exact_f32(a) || !exact_f32(b) {
            return Ok(false);
        }
        numbers[i] = a;
        old_bits[i] = (a as f32).to_bits();
        new_bits[i] = (b as f32).to_bits();
        same &= old_bits[i] == new_bits[i];
    }
    if same {
        writer.byte(DELTA_SAME);
        return Ok(true);
    }
    let mut history = [0.0; 64];
    let use_history = before
        .and_then(Value::as_array)
        .filter(|v| v.len() == count)
        .is_some_and(|values| {
            for (i, value) in values.iter().enumerate() {
                let Some(value) = number(value).filter(|v| exact_f32(*v)) else {
                    return false;
                };
                history[i] = value;
            }
            true
        });
    let modes = if use_history { 4 } else { 2 };
    let mut residuals = [[0u64; 64]; 4];
    let mut sizes = [0usize; 4];
    let mut unions = [0u64; 4];
    fn difference(a: u32, b: u32) -> u64 {
        let delta = b.wrapping_sub(a) as i32;
        u64::from(((delta as u32) << 1) ^ ((delta >> 31) as u32))
    }
    for i in 0..count {
        residuals[0][i] = u64::from(old_bits[i] ^ new_bits[i]);
        residuals[1][i] = difference(old_bits[i], new_bits[i]);
        if use_history {
            residuals[2][i] = difference(
                old_bits[i]
                    .wrapping_mul(2)
                    .wrapping_sub((history[i] as f32).to_bits()),
                new_bits[i],
            );
            residuals[3][i] = difference(predict_value_bits(history[i], numbers[i]), new_bits[i]);
        }
        for mode in 0..modes {
            sizes[mode] += varuint_length(residuals[mode][i]);
            unions[mode] |= residuals[mode][i];
        }
    }
    let kinds = [
        DELTA_DENSE_FLOAT32_XOR_ARRAY,
        DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY,
        DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY,
        DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY,
    ];
    let candidate = |mode: usize| {
        let bit_width = (64 - unions[mode].leading_zeros()) as u8;
        let packed = 2 + (usize::from(bit_width) * count).div_ceil(8);
        let use_packed = packed * 4 <= sizes[mode] * 3;
        FloatCandidate {
            kind: if use_packed {
                DELTA_DENSE_FLOAT32_BITPACKED_ARRAY
            } else {
                kinds[mode]
            },
            mode: mode as u8,
            bit_width,
            bytes: if use_packed { packed } else { sizes[mode] },
        }
    };
    let mut selected = candidate(0);
    for mode in 1..modes {
        let next = candidate(mode);
        if next.bytes < selected.bytes {
            selected = next;
        }
    }
    let values = &residuals[usize::from(selected.mode)];
    writer.byte(selected.kind);
    if selected.kind == DELTA_DENSE_FLOAT32_BITPACKED_ARRAY {
        writer.byte(selected.mode);
        writer.byte(selected.bit_width);
        write_packed(writer, count, selected.bit_width, |i| values[i]);
    } else {
        for value in &values[..count] {
            writer.varuint(*value)?;
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fused_modes_match_reference_bytes_with_boundaries_and_random_float_bits() {
        let mut seed = 193438u64;
        let mut random = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let value = f32::from_bits(seed as u32);
            if value.is_finite() {
                f64::from(value)
            } else {
                -0.0
            }
        };
        for count in [1, 3, 13, 16, 32, 64, 65] {
            let mut previous = serde_json::json!(vec![0.0; count]);
            let mut before = Value::Null;
            for step in 0..400 {
                let next = if step % 7 == 0 {
                    previous.clone()
                } else {
                    serde_json::json!(
                        (0..count)
                            .map(|i| match (step + i) % 10 {
                                0 => 0.0,
                                1 => -0.0,
                                2 => f32::MAX as f64,
                                3 => -(f32::MAX as f64),
                                4 => f32::MIN_POSITIVE as f64,
                                5 => f32::from_bits(1) as f64,
                                6 => (step as f32 * 0.125) as f64,
                                _ => random(),
                            })
                            .collect::<Vec<_>>()
                    )
                };
                let mut reference = BinaryWriter::new();
                let mut actual = BinaryWriter::new();
                write_delta(&mut reference, Some(&previous), &next, Some(&before)).unwrap();
                if !write(&mut actual, Some(&previous), &next, Some(&before)).unwrap() {
                    assert!(actual.bytes.is_empty());
                    write_delta(&mut actual, Some(&previous), &next, Some(&before)).unwrap();
                }
                assert_eq!(actual.bytes, reference.bytes, "length {count}, step {step}");
                before = std::mem::replace(&mut previous, next);
            }
        }
        for (a, b) in [
            (serde_json::json!([0.1]), serde_json::json!([0.2])),
            (serde_json::json!([1]), serde_json::json!([null])),
            (serde_json::json!([]), serde_json::json!([])),
        ] {
            let mut out = BinaryWriter::new();
            assert!(!write(&mut out, Some(&a), &b, None).unwrap());
            assert!(out.bytes.is_empty());
        }
    }
}
