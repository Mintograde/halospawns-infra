use super::*;
use serde_json::json;

fn player() -> Value {
    let node = [
        -0.0,
        f32::from_bits(1) as f64,
        3.,
        1.,
        1.,
        0.,
        0.,
        0.,
        1.,
        0.,
        0.,
        0.,
        1.,
    ];
    json!({"model_nodes":vec![node; 19], "player_index":0,
        "player_object_data":{"tag_name":"characters\\cyborg_mp\\cyborg_mp"},
        "unknown":{"nested":[null,"kept",-0.0]}})
}

#[test]
fn typed_poses_match_complete_source_through_lifecycle_and_shape_changes() {
    let canonical = player();
    let mut cases = vec![canonical.clone(); 12];
    cases[1].as_object_mut().unwrap().sort_keys();
    cases[2]["player_object_data"]["tag_name"] = json!("unknown");
    cases[3]["model_nodes"] = json!([]);
    cases[4]
        .as_object_mut()
        .unwrap()
        .shift_remove("model_nodes");
    cases[5]["model_nodes"] = Value::Null;
    cases[6]["model_nodes"][0]
        .as_array_mut()
        .unwrap()
        .push(json!(99));
    cases[7]["model_nodes"][0][0] = json!("not numeric");
    cases[8]["model_nodes"].as_array_mut().unwrap().pop();
    cases[9] = Value::Null;
    cases[10]["player_object_data"]["tag_name"] = json!("characters\\cyborg\\cyborg");
    cases[11].as_object_mut().unwrap().shift_remove("unknown");
    cases[11]["different"] = json!([1, 2, 3]);
    let mut ticks: Vec<_> = cases
        .into_iter()
        .map(|player| json!({"objects":[],"players":[player,canonical.clone()]}))
        .collect();
    ticks.push(json!({"objects":[],"players":vec![canonical.clone(); 4]}));
    ticks.push(json!({"objects":[],"players":[]}));
    ticks.push(json!({"objects":[]}));
    ticks.push(json!({"objects":[],"players":[canonical.clone()]}));
    for bytes in [tests::packed_stream(&ticks), tests::stream(&ticks)] {
        let mut reference = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let mut typed = Stream::with_contract(&bytes[..], "HSFT0002").unwrap();
        let mut spare = Value::Null;
        for index in 0..ticks.len() {
            let expected = reference.next().unwrap().unwrap();
            let actual = typed
                .next_incremental_with_poses(spare, true)
                .unwrap()
                .unwrap();
            typed.verify_incremental_source(&actual).unwrap();
            if typed.poses.slices()[0].is_some() {
                let original = typed.poses.poses[0][0][0];
                typed.poses.poses[0][0][0] = 42.;
                assert!(typed.verify_incremental_source(&actual).is_err());
                typed.poses.poses[0][0][0] = original;
            }
            let mut materialized = actual.clone();
            typed.poses.materialize(&mut materialized).unwrap();
            assert_eq!(
                serde_json::to_vec(&materialized).unwrap(),
                serde_json::to_vec(&expected).unwrap()
            );
            if matches!(index, 2..=9 | 13 | 14) {
                assert!(typed.poses.slices()[0].is_none());
            }
            if let Some(pose) = typed.poses.slices()[0] {
                assert_eq!(pose[0][0].to_bits(), (-0.0f64).to_bits());
                assert_eq!(pose[0][1], f32::from_bits(1) as f64);
            }
            spare = actual;
        }
    }
}

#[test]
fn typed_pose_expansion_rolls_back_on_player_key_changes() {
    let mut previous = json!({"objects":[],"players":[player()]});
    let mut next = previous.clone();
    next["players"][0]
        .as_object_mut()
        .unwrap()
        .shift_remove("unknown");
    next["players"][0]["changed"] = json!(true);
    let bytes = tests::packed_stream(&[next.clone()]);
    let frame = &bytes[12..];
    let mut cursor = Cursor(frame, true, MAX_FRAME - 19 * 17);
    let mut poses = PoseState::default();
    cursor
        .incremental_root(&mut previous, &mut ObjectState::default(), Some(&mut poses))
        .unwrap();
    assert!(cursor.0.is_empty());
    assert_eq!(cursor.2, MAX_FRAME);
    assert_eq!(poses.decoded, 1);
    poses.materialize(&mut previous).unwrap();
    assert_eq!(
        serde_json::to_vec(&previous).unwrap(),
        serde_json::to_vec(&next).unwrap()
    );
    assert!(
        Cursor(frame, true, MAX_FRAME - 19 * 17 + 1)
            .incremental_root(&mut previous, &mut ObjectState::default(), Some(&mut poses))
            .is_err()
    );
}

#[test]
fn typed_pose_reader_rejects_truncation_nonfinite_duplicates_and_nesting() {
    let bytes = tests::packed_stream(&[json!({"objects":[],"players":[player()]})]);
    let frame = &bytes[12..];
    for length in 0..frame.len() {
        assert!(
            Cursor(&frame[..length], true, length)
                .incremental_root(
                    &mut Value::Null,
                    &mut ObjectState::default(),
                    Some(&mut PoseState::default())
                )
                .is_err()
        );
    }
    let mut nodes = vec![8, 19, 0, 0, 0];
    for _ in 0..19 {
        nodes.push(12);
        nodes.extend_from_slice(&[0; 52]);
    }
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        nodes[6..10].copy_from_slice(&value.to_le_bytes());
        assert!(
            Cursor(&nodes, true, nodes.len())
                .pose(&mut Vec::new())
                .is_err()
        );
    }
    nodes[6..10].fill(0);
    let mut duplicate = vec![9, 2, 0, 0, 0];
    for _ in 0..2 {
        duplicate.extend_from_slice(&11u32.to_le_bytes());
        duplicate.extend_from_slice(b"model_nodes");
        duplicate.extend_from_slice(&nodes);
    }
    assert!(
        Cursor(&duplicate, true, duplicate.len())
            .player(&mut Value::Null, &mut Vec::new(), &mut false)
            .is_err()
    );
    let mut deep = player();
    let mut nested = Value::Null;
    for _ in 0..32 {
        nested = json!([nested]);
    }
    deep["unknown"] = nested;
    let bytes = tests::packed_stream(&[json!({"objects":[],"players":[deep]})]);
    assert!(
        Stream::with_contract(&bytes[..], "HSFT0002")
            .unwrap()
            .next_incremental_with_poses(Value::Null, true)
            .is_err()
    );
}
