use super::*;

const SOURCE: &[&str] = &[
    "object_id",
    "object_type",
    "tag_name",
    "x",
    "y",
    "z",
    "forward_x",
    "forward_y",
    "forward_z",
    "up_x",
    "up_y",
    "up_z",
    "parent_ref",
    "owner_object_ref",
];
const OUTPUT: &[&str] = &[
    "object_id",
    "object_type",
    "tag_name",
    "x",
    "y",
    "z",
    "forward_x",
    "forward_y",
    "forward_z",
    "up_x",
    "up_y",
    "up_z",
    "owner_object_ref",
    "parent_ref",
];

pub(super) struct Layout {
    limit: usize,
}

impl Layout {
    pub(super) fn compile(projection: &CompiledProjection) -> Option<Self> {
        let CompiledProjection::Object {
            fields,
            source_indexes,
            ..
        } = projection
        else {
            return None;
        };
        let field = &fields[*source_indexes.get("objects")?];
        if field.output_key != "objects" {
            return None;
        }
        let CompiledProjection::Array { limit, items, .. } = &field.node else {
            return None;
        };
        let CompiledProjection::Object {
            fields, required, ..
        } = items.as_ref()
        else {
            return None;
        };
        if required.iter().any(|key| !SOURCE.contains(&key.as_str())) {
            return None;
        }
        let selected: Vec<_> = fields
            .iter()
            .filter(|field| SOURCE.contains(&field.source_key.as_str()))
            .collect();
        if selected.len() != OUTPUT.len()
            || !selected.iter().zip(OUTPUT).all(|(field, expected)| {
                field.output_key == *expected
                    && field.source_key == *expected
                    && matches!(field.node, CompiledProjection::Scalar { nullable: false })
            })
        {
            return None;
        }
        Some(Self { limit: *limit })
    }

    pub(super) fn take(&self, source: &mut Value, projected: &mut Value) -> Option<(Value, Value)> {
        let objects = source.get("objects")?.as_array()?;
        if objects.len() > self.limit
            || !objects.iter().all(|object| {
                object.as_object().is_some_and(|fields| {
                    fields.len() == SOURCE.len()
                        && fields.keys().map(String::as_str).eq(SOURCE.iter().copied())
                        && fields.values().all(|value| {
                            !value.is_null() && !value.is_array() && !value.is_object()
                        })
                })
            })
        {
            return None;
        }
        let mut current = std::mem::replace(&mut source["objects"], Value::Array(Vec::new()));
        for object in current.as_array_mut().unwrap() {
            let fields = object.as_object_mut().unwrap();
            let (key, value) = fields.shift_remove_entry("parent_ref").unwrap();
            fields.insert(key, value);
        }
        let mut spare = projected
            .get_mut("objects")
            .map(Value::take)
            .unwrap_or(Value::Null);
        if let Some(objects) = spare.as_array_mut() {
            for object in objects {
                if let Some(fields) = object.as_object_mut()
                    && fields.len() == OUTPUT.len()
                    && fields.keys().map(String::as_str).eq(OUTPUT.iter().copied())
                {
                    let (key, value) = fields.shift_remove_entry("owner_object_ref").unwrap();
                    fields.insert(key, value);
                }
            }
        }
        Some((current, spare))
    }
}
