use super::*;
use crate::fast_schema::Validator;

pub(super) struct Layout {
    maximum_nodes: usize,
    minimum_number: f64,
    maximum_number: f64,
}

fn field<'a>(projection: &'a CompiledProjection, key: &str) -> Option<&'a CompiledProjection> {
    let CompiledProjection::Object {
        fields,
        source_indexes,
        ..
    } = projection
    else {
        return None;
    };
    let selected = fields.get(*source_indexes.get(key)?)?;
    (selected.output_key == key).then_some(&selected.node)
}

fn schema_field<'a>(validator: &'a Validator, key: &str) -> Option<&'a Validator> {
    let Validator::Object { fields, .. } = validator else {
        return None;
    };
    fields.get(key)
}

impl Layout {
    pub(super) fn compile(projection: &Projection, validator: &Validator) -> Option<Self> {
        if projection.revision != 4 || MAX_JSON_DEPTH < 8 {
            return None;
        }
        let CompiledProjection::Array {
            limit: 4,
            take_first: false,
            items: player,
        } = field(&projection.tick, "players")?
        else {
            return None;
        };
        let CompiledProjection::Array {
            limit,
            take_first: false,
            items: node,
        } = field(player, "model_nodes")?
        else {
            return None;
        };
        let CompiledProjection::Array {
            limit: 13,
            items: number,
            ..
        } = node.as_ref()
        else {
            return None;
        };
        if !matches!(number.as_ref(), CompiledProjection::Scalar { .. }) {
            return None;
        }
        let Validator::Array { items: player, .. } = schema_field(validator, "players")? else {
            return None;
        };
        let Validator::Array {
            minimum: 0,
            maximum,
            items: node,
        } = schema_field(player, "model_nodes")?
        else {
            return None;
        };
        let Validator::Array {
            minimum,
            maximum: node_maximum,
            items: number,
        } = node.as_ref()
        else {
            return None;
        };
        if *minimum > 13 || *node_maximum < 13 {
            return None;
        }
        let Validator::Number {
            minimum,
            maximum: number_maximum,
            integer: false,
        } = number.as_ref()
        else {
            return None;
        };
        Some(Self {
            maximum_nodes: (*limit).min(*maximum),
            minimum_number: *minimum,
            maximum_number: *number_maximum,
        })
    }

    pub(super) fn validate(
        &self,
        poses: &crate::transport::PoseState,
    ) -> Result<(), Box<dyn Error>> {
        for pose in poses.slices().into_iter().flatten() {
            if pose.len() > self.maximum_nodes
                || pose.iter().flatten().any(|value| {
                    !value.is_finite()
                        || *value < self.minimum_number
                        || *value > self.maximum_number
                })
            {
                return Err("typed pose violates its closed schema".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_pose_schema_proof_matches_complete_validation() {
        let projection = Projection::load_revision(4).unwrap();
        let validator = Validator::for_revision(4).unwrap();
        let layout = Layout::compile(&projection, &validator).unwrap();
        for value in [
            -1_000_000_000.,
            1_000_000_000.,
            0.,
            -0.0,
            f32::from_bits(1_000_000_000f32.to_bits() + 1) as f64,
            -f32::MAX as f64,
            f32::MAX as f64,
        ] {
            let mut source = pose_tests::source().remove(0);
            source["players"][0]["model_nodes"][0][0] = Value::from(value);
            let bytes = crate::transport::tests::packed_stream(&[source]);
            let mut input =
                crate::transport::Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
            let tick = input
                .next_incremental_with_poses(Value::Null, true)
                .unwrap()
                .unwrap();
            assert_eq!(input.poses.decoded, 1);
            input.verify_incremental_source(&tick).unwrap();
            let mut materialized = tick.clone();
            input.poses.materialize(&mut materialized).unwrap();
            let expected = projection.tick.project(&materialized).unwrap();
            let projected = projection.tick.project(&tick).unwrap();
            assert!(validator.is_valid(&projected));
            assert_eq!(
                layout.validate(&input.poses).is_ok(),
                validator.is_valid(&expected)
            );
            assert_eq!(
                layout.validate(&input.poses).is_ok(),
                projection.tick_validator.is_valid(&expected)
            );
        }
    }

    #[test]
    fn typed_layout_fails_closed_for_unproven_contracts() {
        for revision in 1..=3 {
            assert!(
                Layout::compile(
                    &Projection::load_revision(revision).unwrap(),
                    &Validator::for_revision(revision).unwrap()
                )
                .is_none()
            );
        }
        let projection = Projection::load_revision(4).unwrap();
        assert!(Layout::compile(&projection, &Validator::Any(true)).is_none());
        let mut validator = Validator::for_revision(4).unwrap();
        let Validator::Object { fields, .. } = &mut validator else {
            panic!();
        };
        let Validator::Array { items, .. } = fields.get_mut("players").unwrap() else {
            panic!();
        };
        let Validator::Object { fields, .. } = items.as_mut() else {
            panic!();
        };
        fields.insert("model_nodes".into(), Validator::Any(true));
        assert!(Layout::compile(&projection, &validator).is_none());
    }
}
