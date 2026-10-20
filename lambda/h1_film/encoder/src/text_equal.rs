#[inline]
pub fn equal(left: &str, right: &str) -> bool {
    let length = left.len();
    if length != right.len() {
        return false;
    }
    let left = left.as_bytes();
    let right = right.as_bytes();
    match length {
        0 => true,
        1..=3 => {
            left[0] == right[0]
                && left[length / 2] == right[length / 2]
                && left[length - 1] == right[length - 1]
        }
        4..=8 => {
            u32::from_ne_bytes(left[..4].try_into().unwrap())
                == u32::from_ne_bytes(right[..4].try_into().unwrap())
                && u32::from_ne_bytes(left[length - 4..].try_into().unwrap())
                    == u32::from_ne_bytes(right[length - 4..].try_into().unwrap())
        }
        9..=16 => {
            u64::from_ne_bytes(left[..8].try_into().unwrap())
                == u64::from_ne_bytes(right[..8].try_into().unwrap())
                && u64::from_ne_bytes(left[length - 8..].try_into().unwrap())
                    == u64::from_ne_bytes(right[length - 8..].try_into().unwrap())
        }
        17..=32 => {
            u128::from_ne_bytes(left[..16].try_into().unwrap())
                == u128::from_ne_bytes(right[..16].try_into().unwrap())
                && u128::from_ne_bytes(left[length - 16..].try_into().unwrap())
                    == u128::from_ne_bytes(right[length - 16..].try_into().unwrap())
        }
        _ => left == right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_every_byte_at_all_boundaries() {
        for length in 0..=160 {
            let bytes: Vec<_> = (0..length).map(|index| 32 + (index % 90) as u8).collect();
            let text = std::str::from_utf8(&bytes).unwrap();
            assert!(equal(text, text));
            for index in 0..length {
                let mut other = bytes.clone();
                other[index] ^= 1;
                let other = std::str::from_utf8(&other).unwrap();
                assert!(!equal(text, other), "length {length}, index {index}");
                assert!(!equal(other, text));
                assert!(!equal(text, &text[..index]));
            }
        }
        for left in ["", "é", "🦀", "e\u{301}", "東京", "abcdefghijklmnopé"] {
            for right in ["", "é", "🦀", "e\u{301}", "東京", "abcdefghijklmnopé"] {
                assert_eq!(equal(left, right), left == right);
            }
        }
    }
}
