use serde_json::{Map, Value};
use std::collections::VecDeque;
use std::sync::Arc;

pub struct Pool<Record> {
    entries: VecDeque<(usize, Arc<Record>)>,
    bytes: usize,
}

impl<Record> Default for Pool<Record> {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            bytes: 0,
        }
    }
}

impl<Record> Pool<Record> {
    pub fn take(&mut self) -> Option<Arc<Record>> {
        let (bytes, mut record) = self.entries.pop_front()?;
        self.bytes -= bytes;
        if Arc::get_mut(&mut record).is_some() {
            Some(record)
        } else {
            self.retire(record, bytes);
            None
        }
    }

    pub fn retire(&mut self, record: Arc<Record>, bytes: usize) {
        if bytes > 16 * 1024 * 1024 {
            return;
        }
        self.bytes += bytes;
        self.entries.push_back((bytes, record));
        while self.bytes > 16 * 1024 * 1024 || self.entries.len() > 4096 {
            let (bytes, _) = self.entries.pop_front().unwrap();
            self.bytes -= bytes;
        }
    }
}

pub fn map(target: &mut Map<String, Value>, source: &Map<String, Value>) {
    if target.len() == source.len()
        && target
            .keys()
            .zip(source.keys())
            .all(|(key, other)| crate::text_equal::equal(key, other))
    {
        for (target, source) in target.values_mut().zip(source.values()) {
            value(target, source);
        }
    } else {
        *target = source.clone();
    }
}

pub fn value(target: &mut Value, source: &Value) {
    match (target, source) {
        (Value::Object(target), Value::Object(source)) => map(target, source),
        (Value::Array(target), Value::Array(source)) => {
            target.resize_with(source.len(), || Value::Null);
            for (target, source) in target.iter_mut().zip(source) {
                value(target, source);
            }
        }
        (Value::String(target), Value::String(source)) => {
            if !crate::text_equal::equal(target, source) {
                target.clone_from(source);
            }
        }
        (target, source) => *target = source.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shared_records_are_never_mutated_and_retirement_is_bounded() {
        let mut pool = Pool::default();
        let retained = Arc::new(42);
        pool.retire(retained.clone(), 10);
        assert!(pool.take().is_none());
        assert_eq!(*retained, 42);
        drop(retained);
        let mut reusable = pool.take().unwrap();
        *Arc::get_mut(&mut reusable).unwrap() = 99;
        assert_eq!(*reusable, 99);
        for number in 0..5000 {
            pool.retire(Arc::new(number), 8192);
        }
        assert!(pool.entries.len() <= 4096);
        assert!(pool.bytes <= 16 * 1024 * 1024);
        pool.retire(Arc::new(0), usize::MAX);
        assert!(pool.bytes <= 16 * 1024 * 1024);
    }

    #[test]
    fn recycled_values_preserve_order_shapes_and_float_bits() {
        let mut target = Value::Null;
        for source in [
            json!({"name":"a","data":[1,-0.0,{"x":2}]}),
            json!({"name":"a","data":[null,0.0,{"x":3}]}),
            json!({"data":[],"name":"changed"}),
            json!([false, 1]),
            Value::Null,
        ] {
            value(&mut target, &source);
            assert_eq!(
                serde_json::to_vec(&target).unwrap(),
                serde_json::to_vec(&source).unwrap()
            );
        }
    }
}
