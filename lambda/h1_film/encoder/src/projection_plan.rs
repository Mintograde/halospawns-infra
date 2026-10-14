use super::*;

#[derive(Default)]
pub(super) struct Plan {
    initialized: bool,
    keys: Vec<String>,
    slots: Vec<(Option<usize>, bool)>,
    children: Vec<Self>,
}

impl Plan {
    pub(super) fn project(
        &mut self,
        projection: &CompiledProjection,
        source: &Value,
        target: &mut Value,
    ) -> Result<(), Box<dyn Error>> {
        match (projection, source) {
            (CompiledProjection::Nullable(inner), _) if !source.is_null() => {
                self.project(inner, source, target)
            }
            (
                CompiledProjection::Object {
                    fields,
                    required,
                    source_indexes,
                },
                Value::Object(source),
            ) if fields.len() <= 64 => {
                if !self.initialized
                    || self.keys.len() != source.len()
                    || !self.keys.iter().eq(source.keys())
                {
                    if required.iter().any(|key| !source.contains_key(key)) {
                        return Err("viewer projection is missing a required object field".into());
                    }
                    self.keys = source.keys().cloned().collect();
                    self.initialized = true;
                    self.slots = self
                        .keys
                        .iter()
                        .map(|key| (source_indexes.get(key).copied(), required.contains(key)))
                        .collect();
                }
                self.children.resize_with(fields.len(), Self::default);
                let mut selected = [None; 64];
                let mut count = 0;
                for (value, &(index, required)) in source.values().zip(&self.slots) {
                    if required && value.is_null() {
                        return Err("viewer projection is missing a required object field".into());
                    }
                    if let Some(index) = index
                        && (!value.is_null() || fields[index].node.nullable())
                    {
                        selected[index] = Some(value);
                        count += 1;
                    }
                }
                let selected_keys = || {
                    fields
                        .iter()
                        .zip(selected)
                        .filter_map(|(field, value)| value.map(|_| &field.output_key))
                };
                if let Value::Object(output) = target
                    && output.len() == count
                    && output.keys().eq(selected_keys())
                {
                    for ((field, plan, source), target) in fields
                        .iter()
                        .zip(&mut self.children)
                        .zip(selected)
                        .filter_map(|((field, plan), value)| {
                            value.map(|value| (field, plan, value))
                        })
                        .zip(output.values_mut())
                    {
                        plan.project(&field.node, source, target)?;
                    }
                } else {
                    let mut previous = std::mem::take(target);
                    let mut output = Map::with_capacity(count);
                    for ((field, plan), source) in
                        fields.iter().zip(&mut self.children).zip(selected)
                    {
                        if let Some(source) = source {
                            let (key, mut target) = previous
                                .as_object_mut()
                                .and_then(|old| old.swap_remove_entry(&field.output_key))
                                .unwrap_or_else(|| (field.output_key.clone(), Value::Null));
                            plan.project(&field.node, source, &mut target)?;
                            output.insert(key, target);
                        }
                    }
                    *target = Value::Object(output);
                }
                Ok(())
            }
            (
                CompiledProjection::Array {
                    limit,
                    take_first,
                    items,
                },
                Value::Array(source),
            ) if !matches!(items.as_ref(), CompiledProjection::Scalar { .. }) => {
                if !take_first && source.len() > *limit {
                    return Err("viewer projection array exceeds its pinned limit".into());
                }
                let count = source.len().min(*limit);
                if !target.is_array() {
                    *target = Value::Array(Vec::new());
                }
                let output = target.as_array_mut().unwrap();
                output.resize_with(count, || Value::Null);
                self.children.resize_with(count, Self::default);
                for ((source, target), plan) in source.iter().zip(output).zip(&mut self.children) {
                    plan.project(items, source, target)?;
                }
                Ok(())
            }
            _ => projection.project_reusing(source, target),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changing_shapes_nulls_and_recycled_outputs_match_reference() {
        for revision in 1..=4 {
            let projection = Projection::load_revision(revision).unwrap();
            let mut plan = Plan::default();
            let mut recycled = Value::Null;
            let base = serde_json::json!({"current_tick":0,"current_game_time_seconds":0.0,
                "players":[{"player_index":0,"name":"é","player_object_data":{"x":-0.0,"y":1.0,"z":2.0}}],
                "objects":[{"object_id":1,"object_type":0,"x":-0.0,"owner_object_ref":-1,"parent_ref":-1}],
                "game_time_info":{"game_time":0},"multiplayer_map_name":"prisoner"});
            let mut cases = vec![serde_json::json!({}), base.clone()];
            for key in [
                "players",
                "objects",
                "current_tick",
                "current_game_time_seconds",
                "game_time_info",
                "multiplayer_map_name",
            ] {
                for value in [
                    Value::Null,
                    serde_json::json!({"extra":1}),
                    serde_json::json!([1]),
                    serde_json::json!(false),
                ] {
                    let mut changed = base.clone();
                    changed[key] = value;
                    cases.push(changed);
                }
                let mut changed = base.clone();
                changed.as_object_mut().unwrap().shift_remove(key);
                cases.push(changed);
            }
            let mut reordered = base.clone();
            reordered.as_object_mut().unwrap().sort_keys();
            cases.push(reordered);
            let mut wider = base.clone();
            wider["objects"][0]["ignored"] = serde_json::json!([1, 2]);
            wider["objects"][0]["x"] = serde_json::json!(2.0);
            cases.push(wider);
            for source in cases.iter().cycle().take(cases.len() * 3) {
                let reference = projection.tick.project(source);
                let actual = plan.project(&projection.tick, source, &mut recycled);
                assert_eq!(actual.is_ok(), reference.is_ok());
                if let Ok(reference) = reference {
                    assert!(deep_exact_equal(&reference, &recycled));
                    assert_eq!(
                        serde_json::to_vec(&reference).unwrap(),
                        serde_json::to_vec(&recycled).unwrap()
                    );
                }
            }
        }
    }
}
