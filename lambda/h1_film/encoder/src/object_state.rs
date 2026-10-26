use super::*;
use crate::transport::ObjectRecord;

pub(super) struct ProjectedRecord {
    source: Arc<ObjectRecord>,
    value: Value,
    retained_bytes: usize,
}

#[derive(Clone)]
pub(super) struct Records {
    objects: Vec<Arc<ProjectedRecord>>,
    pub spawns: Option<Arc<ProjectedSpawns>>,
}

impl std::ops::Deref for Records {
    type Target = Vec<Arc<ProjectedRecord>>;
    fn deref(&self) -> &Self::Target {
        &self.objects
    }
}

pub(super) struct ProjectedSpawns {
    source: Arc<crate::transport::SpawnRecord>,
    value: Value,
}

#[derive(Default)]
pub(super) struct SpawnCache(Option<Arc<ProjectedSpawns>>);

impl SpawnCache {
    pub(super) fn supported(
        projection: &Projection,
        validator: &crate::fast_schema::Validator,
    ) -> bool {
        Self::layout(projection, validator).is_some()
    }

    fn layout<'a>(
        projection: &'a Projection,
        validator: &'a crate::fast_schema::Validator,
    ) -> Option<(&'a CompiledProjection, &'a crate::fast_schema::Validator)> {
        let CompiledProjection::Object {
            fields,
            source_indexes,
            ..
        } = &projection.tick
        else {
            return None;
        };
        let field = fields.get(*source_indexes.get("spawns")?)?;
        let CompiledProjection::Array { .. } = &field.node else {
            return None;
        };
        if field.output_key != "spawns" {
            return None;
        }
        let crate::fast_schema::Validator::Object { fields, .. } = validator else {
            return None;
        };
        let schema = fields.get("spawns")?;
        if !matches!(
            schema,
            crate::fast_schema::Validator::Array { minimum: 0, .. }
        ) {
            return None;
        }
        Some((&field.node, schema))
    }

    pub(super) fn project(
        &mut self,
        source: Option<&Arc<crate::transport::SpawnRecord>>,
        projection: &Projection,
        validator: &crate::fast_schema::Validator,
    ) -> Result<Option<Arc<ProjectedSpawns>>, Box<dyn Error>> {
        let Some(source) = source else {
            self.0 = None;
            return Ok(None);
        };
        if self
            .0
            .as_ref()
            .is_some_and(|previous| Arc::ptr_eq(&previous.source, source))
        {
            return Ok(self.0.clone());
        }
        let (plan, schema) =
            Self::layout(projection, validator).ok_or("unsupported cached spawn layout")?;
        validate_json_safety(source.source(), 4)?;
        let value = plan.project(source.source())?;
        if !schema.is_valid(&value) {
            return Err("viewer spawns violate their closed schema".into());
        }
        self.0 = Some(Arc::new(ProjectedSpawns {
            source: source.clone(),
            value,
        }));
        Ok(self.0.clone())
    }
}

#[derive(Default)]
pub(super) struct ProjectionCache {
    records: Vec<Arc<ProjectedRecord>>,
    spares: crate::recycle::Pool<ProjectedRecord>,
}

impl ProjectionCache {
    pub(super) fn layout<'a>(
        projection: &'a Projection,
        validator: &'a crate::fast_schema::Validator,
    ) -> Option<(
        &'a CompiledProjection,
        usize,
        bool,
        &'a crate::fast_schema::Validator,
        usize,
    )> {
        let CompiledProjection::Object {
            fields,
            source_indexes,
            ..
        } = &projection.tick
        else {
            return None;
        };
        let field = fields.get(*source_indexes.get("objects")?)?;
        if field.output_key != "objects" {
            return None;
        }
        let CompiledProjection::Array {
            limit,
            take_first,
            items,
        } = &field.node
        else {
            return None;
        };
        let crate::fast_schema::Validator::Object { fields, .. } = validator else {
            return None;
        };
        let crate::fast_schema::Validator::Array {
            minimum: 0,
            maximum,
            items: schema,
        } = fields.get("objects")?
        else {
            return None;
        };
        Some((items, *limit, *take_first, schema, *maximum))
    }

    pub(super) fn project(
        &mut self,
        source: &[Arc<ObjectRecord>],
        projection: &Projection,
        validator: &crate::fast_schema::Validator,
    ) -> Result<Records, Box<dyn Error>> {
        let (items, limit, take_first, schema, maximum) =
            Self::layout(projection, validator).ok_or("unsupported incremental object layout")?;
        if (!take_first && source.len() > limit) || source.len().min(limit) > maximum {
            return Err("viewer object array exceeds its pinned limit".into());
        }
        for (index, record) in source.iter().enumerate() {
            if self
                .records
                .get(index)
                .is_some_and(|previous| Arc::ptr_eq(&previous.source, record))
            {
                continue;
            }
            validate_json_safety(record.source(), 5)?;
            if index >= limit {
                continue;
            }
            let mut projected = self.spares.take().unwrap_or_else(|| {
                Arc::new(ProjectedRecord {
                    source: record.clone(),
                    value: Value::Null,
                    retained_bytes: 0,
                })
            });
            let reusable = Arc::get_mut(&mut projected).unwrap();
            items.project_reusing(record.source(), &mut reusable.value)?;
            if !schema.is_valid(&reusable.value) {
                return Err("viewer object violates its closed schema".into());
            }
            reusable.source = record.clone();
            reusable.retained_bytes = reusable
                .retained_bytes
                .saturating_add(record.retained_bytes());
            if let Some(previous) = self.records.get_mut(index) {
                let previous = std::mem::replace(previous, projected);
                let bytes = previous.retained_bytes;
                self.spares.retire(previous, bytes);
            } else {
                self.records.push(projected);
            }
        }
        self.records.truncate(source.len().min(limit));
        Ok(Records {
            objects: self.records.clone(),
            spawns: None,
        })
    }
}

fn same_record(previous: &Arc<ProjectedRecord>, next: &Arc<ProjectedRecord>) -> bool {
    Arc::ptr_eq(previous, next) || ordered_delta::same(&previous.value, &next.value)
}

fn same_records(previous: &[Arc<ProjectedRecord>], next: &[Arc<ProjectedRecord>]) -> bool {
    previous.len() == next.len()
        && previous
            .iter()
            .zip(next)
            .all(|(previous, next)| same_record(previous, next))
}

fn write_records(
    writer: &mut BinaryWriter,
    records: &[Arc<ProjectedRecord>],
) -> Result<(), Box<dyn Error>> {
    writer.byte(VALUE_ARRAY);
    writer.varuint(records.len() as u64)?;
    for record in records {
        write_value(writer, &record.value)?;
    }
    Ok(())
}

fn write_record_delta(
    writer: &mut BinaryWriter,
    previous: &[Arc<ProjectedRecord>],
    next: &[Arc<ProjectedRecord>],
    before: Option<&[Arc<ProjectedRecord>]>,
) -> Result<(), Box<dyn Error>> {
    let changed: Vec<_> = next
        .iter()
        .enumerate()
        .filter_map(|(index, record)| {
            previous
                .get(index)
                .is_none_or(|previous| !same_record(previous, record))
                .then_some(index)
        })
        .collect();
    if changed.is_empty() && previous.len() == next.len() {
        writer.byte(DELTA_SAME);
        return Ok(());
    }
    let write_changed = |writer: &mut BinaryWriter, index: usize| {
        ordered_delta::write(
            writer,
            previous.get(index).map(|record| &record.value),
            &next[index].value,
            before
                .and_then(|records| records.get(index))
                .map(|record| &record.value),
        )
    };
    if previous.len() == next.len() && changed.len() > next.len() / 2 {
        writer.byte(DELTA_DENSE_ARRAY);
        let mut changed = changed.into_iter().peekable();
        for index in 0..next.len() {
            if changed.peek() == Some(&index) {
                changed.next();
                write_changed(writer, index)?;
            } else {
                writer.byte(DELTA_SAME);
            }
        }
    } else {
        writer.byte(DELTA_ARRAY);
        writer.varuint(next.len() as u64)?;
        writer.varuint(changed.len() as u64)?;
        for index in changed {
            writer.varuint(index as u64)?;
            write_changed(writer, index)?;
        }
    }
    Ok(())
}

pub(super) fn write_tick(
    writer: &mut BinaryWriter,
    previous: Option<&Value>,
    next: &Value,
    before: Option<&Value>,
    previous_objects: Option<&Records>,
    objects: &Records,
    before_objects: Option<&Records>,
) -> Result<(), Box<dyn Error>> {
    let next = next.as_object().ok_or("invalid incremental tick")?;
    if next
        .get("objects")
        .and_then(Value::as_array)
        .is_none_or(|values| !values.is_empty())
    {
        return Err("incremental object placeholder changed".into());
    }
    if objects.spawns.is_some()
        && next
            .get("spawns")
            .and_then(Value::as_array)
            .is_none_or(|values| !values.is_empty())
    {
        return Err("incremental spawn placeholder changed".into());
    }
    let Some(previous) = previous.and_then(Value::as_object) else {
        writer.byte(VALUE_OBJECT);
        writer.varuint(next.len() as u64)?;
        for (key, value) in next {
            writer.string(key)?;
            if key == "objects" {
                write_records(writer, objects)?;
            } else {
                write_value(writer, field_value(key, value, Some(objects)))?;
            }
        }
        return Ok(());
    };
    let previous_objects = previous_objects.ok_or("missing incremental object history")?;
    let deletions: Vec<_> = previous
        .keys()
        .filter(|key| !next.contains_key(*key))
        .collect();
    let changes: Vec<_> = next
        .iter()
        .filter(|(key, value)| {
            if key.as_str() == "objects" {
                !same_records(previous_objects, objects)
            } else if key.as_str() == "spawns"
                && objects
                    .spawns
                    .as_ref()
                    .zip(previous_objects.spawns.as_ref())
                    .is_some_and(|(next, previous)| Arc::ptr_eq(next, previous))
            {
                false
            } else {
                previous.get(*key).is_none_or(|previous| {
                    !ordered_delta::same(
                        field_value(key, previous, Some(previous_objects)),
                        field_value(key, value, Some(objects)),
                    )
                })
            }
        })
        .collect();
    if deletions.is_empty() && changes.is_empty() {
        writer.byte(DELTA_SAME);
        return Ok(());
    }
    writer.byte(DELTA_OBJECT);
    writer.varuint(deletions.len() as u64)?;
    for key in deletions {
        writer.string(key)?;
    }
    writer.varuint(changes.len() as u64)?;
    for (key, value) in changes {
        writer.string(key)?;
        if key == "objects" {
            write_record_delta(
                writer,
                previous_objects,
                objects,
                before_objects.map(|records| records.as_slice()),
            )?;
        } else {
            ordered_delta::write(
                writer,
                previous
                    .get(key)
                    .map(|value| field_value(key, value, Some(previous_objects))),
                field_value(key, value, Some(objects)),
                before
                    .and_then(|before| before.get(key))
                    .map(|value| field_value(key, value, before_objects)),
            )?;
        }
    }
    Ok(())
}

fn field_value<'a>(key: &str, value: &'a Value, records: Option<&'a Records>) -> &'a Value {
    if key == "spawns" {
        records
            .and_then(|records| records.spawns.as_ref())
            .map_or(value, |spawns| &spawns.value)
    } else {
        value
    }
}

fn shared_decoded(previous: &DecodedValue, next: &DecodedValue) -> bool {
    match (previous, next) {
        (DecodedValue::Object(previous), DecodedValue::Object(next)) => Arc::ptr_eq(previous, next),
        (DecodedValue::Array(previous), DecodedValue::Array(next)) => Arc::ptr_eq(previous, next),
        _ => false,
    }
}

pub(super) fn exact_tick(
    source: &Value,
    objects: &Records,
    decoded: &DecodedValue,
    previous_objects: Option<&Records>,
    previous_decoded: Option<&DecodedValue>,
) -> bool {
    let (Some(source), DecodedValue::Object(decoded)) = (source.as_object(), decoded) else {
        return false;
    };
    let prior = previous_decoded
        .and_then(|previous| match previous {
            DecodedValue::Object(previous) => previous.get("objects"),
            _ => None,
        })
        .and_then(|objects| match objects {
            DecodedValue::Array(objects) => Some(objects),
            _ => None,
        });
    source.len() == decoded.len()
        && source.iter().all(|(key, value)| {
            let Some(decoded) = decoded.get(key.as_str()) else {
                return false;
            };
            if key == "spawns"
                && let Some(spawns) = &objects.spawns
            {
                let reused = previous_objects
                    .and_then(|previous| previous.spawns.as_ref())
                    .is_some_and(|previous| Arc::ptr_eq(previous, spawns))
                    && previous_decoded
                        .and_then(|previous| match previous {
                            DecodedValue::Object(previous) => previous.get("spawns"),
                            _ => None,
                        })
                        .is_some_and(|previous| shared_decoded(previous, decoded));
                return reused || exact_decoded(&spawns.value, decoded);
            }
            if key != "objects" {
                return exact_decoded(value, decoded);
            }
            let DecodedValue::Array(decoded) = decoded else {
                return false;
            };
            decoded.len() == objects.len()
                && objects.iter().zip(decoded.iter()).enumerate().all(
                    |(index, (object, decoded))| {
                        let reused = previous_objects
                            .and_then(|previous| previous.get(index))
                            .is_some_and(|previous| Arc::ptr_eq(previous, object))
                            && prior
                                .and_then(|previous| previous.get(index))
                                .is_some_and(|previous| shared_decoded(previous, decoded));
                        reused || exact_decoded(&object.value, decoded)
                    },
                )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{ObjectState, Stream, tests::stream};

    #[test]
    fn cached_spawns_match_generic_bytes_across_changes_absence_and_chunk_boundaries() {
        for revision in [4, 5] {
            cached_spawn_bytes_for_revision(revision);
        }
    }

    fn cached_spawn_bytes_for_revision(revision: u32) {
        let projection = Projection::load_revision(revision).unwrap();
        let validator = crate::fast_schema::Validator::for_revision(revision).unwrap();
        let point = serde_json::json!({"spawn_index":0,"x":-0.0,"y":1.0,"z":2.0,"facing":0.0,"team":0,"gametypes":[1,2,0,0]});
        let ticks: Vec<_> = (0..KEYFRAME_INTERVAL + 17).map(|frame| {
            let mut tick = serde_json::json!({"current_tick":frame,"players":[],"objects":[],"spawns":[point.clone()]});
            match frame % 71 {
                5 => { tick.as_object_mut().unwrap().shift_remove("spawns"); }
                6 => tick["spawns"] = Value::Null,
                7 => tick["spawns"] = serde_json::json!([]),
                8 => tick["spawns"][0]["x"] = Value::from(0.0),
                9 => tick["spawns"][0].as_object_mut().unwrap().sort_keys(),
                _ => (),
            }
            tick
        }).collect();
        let bytes = stream(&ticks);
        let mut input = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        input.cache_spawns = true;
        let mut cache = ProjectionCache::default();
        let mut spawns = SpawnCache::default();
        let mut spare = Value::Null;
        for (index, ticks) in ticks.chunks(KEYFRAME_INTERVAL).enumerate() {
            let mut generic =
                IncrementalChunk::new(index * KEYFRAME_INTERVAL, ticks.len()).unwrap();
            let mut cached = IncrementalChunk::new(index * KEYFRAME_INTERVAL, ticks.len()).unwrap();
            for expected in ticks {
                let tick = input.next_incremental(spare).unwrap().unwrap();
                input.verify_incremental_source(&tick).unwrap();
                let mut records = cache
                    .project(input.objects.records(), &projection, &validator)
                    .unwrap();
                records.spawns = spawns
                    .project(input.objects.spawns.as_ref(), &projection, &validator)
                    .unwrap();
                generic
                    .push(projection.tick.project(expected).unwrap())
                    .unwrap();
                cached
                    .push_state(projection.tick.project(&tick).unwrap(), Some(records))
                    .unwrap();
                assert_eq!(cached.binary.bytes, generic.binary.bytes);
                spare = tick;
            }
            assert_eq!(cached.tick_hash.finish(), generic.tick_hash.finish());
        }
    }

    #[test]
    fn cached_spawns_validate_schema_source_safety_and_decoder_identity() {
        for revision in [4, 5] {
            cached_spawn_safety_for_revision(revision);
        }
    }

    fn cached_spawn_safety_for_revision(revision: u32) {
        let projection = Projection::load_revision(revision).unwrap();
        let validator = crate::fast_schema::Validator::for_revision(revision).unwrap();
        let point = serde_json::json!({"x":-0.0,"y":1.0,"z":2.0});
        let mut invalid = point.clone();
        invalid["x"] = Value::from("bad");
        let mut unsafe_source = point.clone();
        let mut nested = Value::Null;
        for _ in 0..28 {
            nested = Value::Array(vec![nested]);
        }
        unsafe_source["ignored"] = nested;
        for point in [invalid, unsafe_source] {
            let bytes = stream(&[serde_json::json!({"objects":[],"spawns":[point]})]);
            let mut input = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
            input.cache_spawns = true;
            input.next_incremental(Value::Null).unwrap();
            assert!(
                SpawnCache::default()
                    .project(input.objects.spawns.as_ref(), &projection, &validator)
                    .is_err()
            );
        }
        let bytes = stream(&[serde_json::json!({"objects":[],"spawns":[point]})]);
        let mut input = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        input.cache_spawns = true;
        let tick = input.next_incremental(Value::Null).unwrap().unwrap();
        let mut records = ProjectionCache::default()
            .project(input.objects.records(), &projection, &validator)
            .unwrap();
        records.spawns = SpawnCache::default()
            .project(input.objects.spawns.as_ref(), &projection, &validator)
            .unwrap();
        let source = projection.tick.project(&tick).unwrap();
        let mut writer = BinaryWriter::new();
        write_tick(&mut writer, None, &source, None, None, &records, None).unwrap();
        let decoded = read_value(&mut BinaryReader::new(&writer.bytes), 1).unwrap();
        assert!(exact_tick(
            &source,
            &records,
            &decoded,
            Some(&records),
            Some(&decoded)
        ));
        let mut corrupt = decoded.clone();
        let DecodedValue::Object(root) = &mut corrupt else {
            unreachable!()
        };
        let DecodedValue::Array(points) = Arc::make_mut(root).get_mut("spawns").unwrap() else {
            unreachable!()
        };
        let DecodedValue::Object(point) = &mut Arc::make_mut(points)[0] else {
            unreachable!()
        };
        *Arc::make_mut(point).get_mut("x").unwrap() = DecodedValue::Number(0.0);
        assert!(!exact_tick(
            &source,
            &records,
            &corrupt,
            Some(&records),
            Some(&decoded)
        ));
    }

    fn world(handle: u32, position: f64) -> Value {
        serde_json::json!({"object_id":handle,"object_type":2,"tag_name":"weapons\\pistol\\pistol",
            "x":position,"y":-0.0,"z":1.0,"forward_x":1.0,"forward_y":0.0,"forward_z":0.0,
            "up_x":0.0,"up_y":0.0,"up_z":1.0,"parent_ref":-1,"owner_object_ref":-1})
    }

    fn state(objects: &[Value]) -> ObjectState {
        let bytes = stream(&[serde_json::json!({"objects":objects})]);
        let mut input = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        input.next_incremental(Value::Null).unwrap();
        input.objects
    }

    #[test]
    fn lifecycle_shapes_and_history_match_generic_bytes_and_hashes_across_chunks() {
        let projection = Projection::load_revision(4).unwrap();
        let validator = crate::fast_schema::Validator::for_revision(4).unwrap();
        let ticks: Vec<_> = (0..KEYFRAME_INTERVAL + 37).map(|frame| {
            let mut objects: Vec<_> = (0..12).map(|index| world(index, if index < 3 { frame as f64 / 8.0 } else { 2.0 })).collect();
            if frame % 17 < 3 { objects.truncate(frame % 3); }
            if frame % 23 == 0 { objects.reverse(); }
            if frame % 29 == 0 { objects.clear(); }
            for (index, object) in objects.iter_mut().enumerate() {
                if frame % 11 == 0 { object["object_id"] = Value::from(index as u32 | 0x80010000); }
                if frame % 7 == 0 { object["ignored"] = serde_json::json!({"changed":frame}); }
                if frame % 13 == 0 { object.as_object_mut().unwrap().sort_keys(); }
                if frame % 5 == 0 { object.as_object_mut().unwrap().shift_remove("parent_ref"); }
                if frame % 31 == 0 { object["y"] = Value::from(0.0); }
            }
            serde_json::json!({"current_tick":frame,"current_game_time_seconds":frame as f64/120.0,
                "game_time_info":{"game_time":frame},"players":[],"multiplayer_map_name":"prisoner","objects":objects})
        }).collect();
        let bytes = stream(&ticks);
        let mut input = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let mut cache = ProjectionCache::default();
        let mut spare = Value::Null;
        for (chunk_index, ticks) in ticks.chunks(KEYFRAME_INTERVAL).enumerate() {
            let first = chunk_index * KEYFRAME_INTERVAL;
            let mut generic = IncrementalChunk::new(first, ticks.len()).unwrap();
            let mut incremental = IncrementalChunk::new(first, ticks.len()).unwrap();
            for expected in ticks {
                let tick = input.next_incremental(spare).unwrap().unwrap();
                input.verify_incremental_source(&tick).unwrap();
                let objects = cache
                    .project(input.objects.records(), &projection, &validator)
                    .unwrap();
                let selected = projection.tick.project(&tick).unwrap();
                generic
                    .push(projection.tick.project(expected).unwrap())
                    .unwrap();
                incremental.push_state(selected, Some(objects)).unwrap();
                assert!(
                    incremental.binary.bytes == generic.binary.bytes,
                    "byte mismatch at tick {}",
                    expected["current_tick"]
                );
                spare = tick;
            }
            assert_eq!(incremental.tick_hash.finish(), generic.tick_hash.finish());
        }
        assert!(input.objects.reused > 0);
    }

    #[test]
    fn reuse_validation_requires_both_immutable_source_and_decoder_identity() {
        let projection = Projection::load_revision(4).unwrap();
        let validator = crate::fast_schema::Validator::for_revision(4).unwrap();
        let original = state(&[world(1, -0.0)]);
        let mut cache = ProjectionCache::default();
        let records = cache
            .project(original.records(), &projection, &validator)
            .unwrap();
        let source = serde_json::json!({"objects":[],"current_tick":0});
        let mut writer = BinaryWriter::new();
        write_tick(&mut writer, None, &source, None, None, &records, None).unwrap();
        let decoded = read_value(&mut BinaryReader::new(&writer.bytes), 1).unwrap();
        assert!(exact_tick(
            &source,
            &records,
            &decoded,
            Some(&records),
            Some(&decoded)
        ));
        let mut corrupt = decoded.clone();
        let DecodedValue::Object(root) = &mut corrupt else {
            unreachable!()
        };
        let DecodedValue::Array(objects) = Arc::make_mut(root).get_mut("objects").unwrap() else {
            unreachable!()
        };
        let DecodedValue::Object(object) = &mut Arc::make_mut(objects)[0] else {
            unreachable!()
        };
        *Arc::make_mut(object).get_mut("x").unwrap() = DecodedValue::Number(0.0);
        assert!(!exact_tick(
            &source,
            &records,
            &corrupt,
            Some(&records),
            Some(&decoded)
        ));
        let changed = state(&[world(1, 0.0)]);
        let changed_records = cache
            .project(changed.records(), &projection, &validator)
            .unwrap();
        assert!(!exact_tick(
            &source,
            &changed_records,
            &decoded,
            Some(&records),
            Some(&decoded)
        ));
    }

    #[test]
    fn cached_projection_preserves_closed_schema_and_unprojected_safety_checks() {
        let projection = Projection::load_revision(4).unwrap();
        let validator = crate::fast_schema::Validator::for_revision(4).unwrap();
        let mut invalid = world(1, 1.0);
        invalid["x"] = serde_json::json!([1, 2]);
        let mut unsafe_source = world(1, 1.0);
        let mut nested = Value::Null;
        for _ in 0..28 {
            nested = Value::Array(vec![nested]);
        }
        unsafe_source["ignored"] = nested;
        for value in [invalid, unsafe_source] {
            let state = state(&[value]);
            assert!(
                ProjectionCache::default()
                    .project(state.records(), &projection, &validator)
                    .is_err()
            );
        }
        let state = state(&[world(1, 1.0)]);
        let records = vec![state.records()[0].clone(); 16385];
        assert!(
            ProjectionCache::default()
                .project(&records, &projection, &validator)
                .is_err()
        );
    }
}
