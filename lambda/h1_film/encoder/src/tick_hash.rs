use super::*;

#[derive(Clone, Default)]
struct NumberText {
    bits: u64,
    length: usize,
    bytes: [u8; 32],
}

// Direct-mapped and bounded: collisions only cause a reformat, never a wrong
// value. Repeated matrix constants, coordinates and counters dominate H1 ticks.
pub(super) struct CachedTickHasher {
    digest: Sha256,
    serialized: Vec<u8>,
    numbers: Vec<NumberText>,
    previous_bytes: Vec<u8>,
    previous: Option<DecodedValue>,
    previous_ranges: HashMap<usize, (usize, usize)>,
    ranges: HashMap<usize, (usize, usize)>,
}

impl CachedTickHasher {
    pub(super) fn new() -> Self {
        Self {
            digest: Sha256::new(),
            serialized: Vec::new(),
            numbers: vec![NumberText::default(); 4096],
            previous_bytes: Vec::new(),
            previous: None,
            previous_ranges: HashMap::new(),
            ranges: HashMap::new(),
        }
    }

    fn write(&mut self, value: &DecodedValue) -> Result<(), Box<dyn Error>> {
        // The decoder shares unchanged containers. Keep the preceding root
        // alive so an address cannot be reused for a different cached value.
        let identity = match value {
            DecodedValue::Array(values) => Some(Arc::as_ptr(values) as usize),
            DecodedValue::Object(values) => Some(Arc::as_ptr(values) as usize),
            _ => None,
        };
        let start = self.serialized.len();
        if let Some((from, to)) = identity
            .and_then(|id| self.previous_ranges.get(&id))
            .copied()
        {
            self.serialized
                .extend_from_slice(&self.previous_bytes[from..to]);
            self.remember(identity, start);
            return Ok(());
        }
        match value {
            DecodedValue::Null => self.serialized.extend_from_slice(b"null"),
            DecodedValue::Bool(true) => self.serialized.extend_from_slice(b"true"),
            DecodedValue::Bool(false) => self.serialized.extend_from_slice(b"false"),
            DecodedValue::Number(value) => {
                let bits = value.to_bits();
                let mixed = (bits ^ (bits >> 32)).wrapping_mul(0x9e3779b97f4a7c15);
                let index = (mixed >> 52) as usize;
                let cached = &mut self.numbers[index];
                if cached.length != 0 && cached.bits == bits {
                    self.serialized
                        .extend_from_slice(&cached.bytes[..cached.length]);
                } else {
                    let start = self.serialized.len();
                    write_javascript_number(&mut self.serialized, *value)?;
                    let text = &self.serialized[start..];
                    if text.len() <= cached.bytes.len() {
                        cached.bytes[..text.len()].copy_from_slice(text);
                        cached.bits = bits;
                        cached.length = text.len();
                    }
                }
            }
            DecodedValue::String(value) => write_json_string(&mut self.serialized, value),
            DecodedValue::Array(values) => {
                self.serialized.push(b'[');
                for (index, value) in values.iter().enumerate() {
                    if index != 0 {
                        self.serialized.push(b',');
                    }
                    self.write(value)?;
                }
                self.serialized.push(b']');
            }
            DecodedValue::Object(values) => {
                self.serialized.push(b'{');
                for (index, (key, value)) in values.iter().enumerate() {
                    if index != 0 {
                        self.serialized.push(b',');
                    }
                    write_json_string(&mut self.serialized, key);
                    self.serialized.push(b':');
                    self.write(value)?;
                }
                self.serialized.push(b'}');
            }
        }
        self.remember(identity, start);
        Ok(())
    }

    fn remember(&mut self, identity: Option<usize>, start: usize) {
        if let Some(id) = identity
            && self.ranges.len() < 8192
            && self.serialized.len() <= 2 * 1024 * 1024
        {
            self.ranges.insert(id, (start, self.serialized.len()));
        }
    }

    pub(super) fn update(&mut self, tick: &DecodedValue) -> Result<(), Box<dyn Error>> {
        std::mem::swap(&mut self.serialized, &mut self.previous_bytes);
        std::mem::swap(&mut self.ranges, &mut self.previous_ranges);
        self.serialized.clear();
        self.ranges.clear();
        self.write(tick)?;
        self.digest
            .update(self.serialized.len().to_string().as_bytes());
        self.digest.update(b":");
        self.digest.update(&self.serialized);
        self.previous = Some(tick.clone());
        Ok(())
    }

    pub(super) fn finish(self) -> String {
        digest_hex(self.digest.finalize())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_subtrees_and_cache_limits_preserve_exact_json() {
        let shared = DecodedValue::Array(Arc::new(vec![
            DecodedValue::String(Arc::from("quoted\"\\\n\u{e9}")),
            DecodedValue::Number(-0.0),
        ]));
        let mut expected = TickHasher::new();
        let mut actual = CachedTickHasher::new();
        for index in 0..100 {
            let tick = DecodedValue::Array(Arc::new(vec![
                shared.clone(),
                DecodedValue::Number(index as f64),
                shared.clone(),
            ]));
            for _ in 0..3 {
                expected.update(&tick).unwrap();
                actual.update(&tick).unwrap();
                assert_eq!(actual.serialized, expected.serialized);
            }
        }
        let large = DecodedValue::Array(Arc::new(vec![
            DecodedValue::String(Arc::from("x".repeat(2 * 1024 * 1024))),
            shared,
        ]));
        for _ in 0..3 {
            expected.update(&large).unwrap();
            actual.update(&large).unwrap();
            assert_eq!(actual.serialized, expected.serialized);
            assert!(actual.ranges.is_empty());
        }
        assert_eq!(actual.finish(), expected.finish());
    }

    #[test]
    fn cached_hash_matches_contract_for_repeats_collisions_and_number_boundaries() {
        let mut expected = TickHasher::new();
        let mut actual = CachedTickHasher::new();
        let mut seed = 91234_u64;
        for index in 0..20000 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let random = f64::from_bits(seed);
            let numbers = [
                0.0,
                -0.0,
                1.0,
                -1.0,
                1e-7,
                1e-6,
                1e20,
                1e21,
                f64::MIN_POSITIVE,
                f64::MAX,
                index as f64,
                if random.is_finite() { random } else { 0.0 },
            ];
            let tick = DecodedValue::Array(Arc::new(
                numbers.into_iter().map(DecodedValue::Number).collect(),
            ));
            expected.update(&tick).unwrap();
            actual.update(&tick).unwrap();
            assert_eq!(actual.serialized, expected.serialized);
        }
        assert_eq!(actual.finish(), expected.finish());
    }
}
