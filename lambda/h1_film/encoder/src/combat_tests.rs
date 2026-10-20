use super::*;

fn frame() -> Value {
    json!({
        "players":[{"player_index":0},{"player_index":1},{"player_index":2}],
        "game_ended_this_tick":false,
        "combat":{"schema":"halospawns.h1CombatSource.v1","coverage":[0,0,0,0],
            "weapons":[{"weapon_id":"pistol","tag_path":"weapons\\pistol\\pistol","category":"weapon"}],
            "shots":[],"damage":[],"deaths":[],
            "awards":(0..3).map(|slot| json!({"slot_index":slot,"longest_kill_streak":0,
                "double_kills":0,"triple_kills":0,"overkills":0})).collect::<Vec<_>>()
        }
    })
}

fn shot() -> Value {
    json!({"discharge_id":1,"slot_index":0,"weapon_id":"pistol"})
}

fn damage(victim: u8) -> Value {
    json!({"discharge_id":1,"attacker_slot":0,"victim_slot":victim,"weapon_id":"pistol",
        "relationship":"opponent","shield_damage":0.125,"health_damage":0.25})
}

fn death(victim: u8) -> Value {
    json!({"killer_slot":0,"victim_slot":victim,"kind":"kill","weapon_id":"pistol",
        "headshot":true,"killer_position":[1.0,2.0,3.0],"victim_position":[-1.0,0.0,0.0]})
}

#[test]
fn pellets_splash_and_multiple_victims_connect_a_discharge_once() {
    let mut collector = Combat::default();
    let mut tick = frame();
    tick["combat"]["shots"] = json!([shot()]);
    tick["combat"]["damage"] = json!([damage(1), damage(1), damage(2)]);
    collector.observe(&tick, 0).unwrap();
    let product = collector.product().unwrap();
    assert_eq!(product["shots"][0]["shots_fired"], 1);
    assert_eq!(product["shots"][0]["shots_hit"], 1);
    assert_eq!(product["damage"][0]["shield_damage"], 0.25);
    assert_eq!(product["damage"][0]["health_damage"], 0.5);
    assert_eq!(product["damage"].as_array().unwrap().len(), 2);
}

#[test]
fn delayed_projectiles_keep_their_discharge_and_end_tick_counts_but_postgame_does_not() {
    let mut collector = Combat::default();
    let mut tick = frame();
    tick["combat"]["shots"] = json!([shot()]);
    collector.observe(&tick, 0).unwrap();
    tick["combat"]["shots"] = json!([]);
    tick["game_ended_this_tick"] = json!(true);
    tick["combat"]["damage"] = json!([damage(1)]);
    tick["combat"]["deaths"] = json!([death(1), death(2)]);
    collector.observe(&tick, 1).unwrap();
    collector.observe(&tick, 2).unwrap();
    let product = collector.product().unwrap();
    assert_eq!(product["shots"][0]["shots_hit"], 1);
    assert_eq!(product["deaths"].as_array().unwrap().len(), 2);
    assert_eq!(product["deaths"][0]["source_tick"], 1);
    assert_eq!(product["deaths"][1]["event_index"], 1);
}

#[test]
fn out_of_window_hits_and_friendly_self_environment_damage_do_not_count_as_hits() {
    let mut collector = Combat::default();
    let mut tick = frame();
    tick["combat"]["shots"] = json!([shot()]);
    let mut friendly = damage(1);
    friendly["relationship"] = json!("friendly");
    let mut own = damage(0);
    own["relationship"] = json!("self");
    let mut environment = damage(1);
    environment["relationship"] = json!("environment");
    environment["attacker_slot"] = Value::Null;
    environment["weapon_id"] = Value::Null;
    environment["discharge_id"] = Value::Null;
    tick["combat"]["damage"] = json!([friendly, own, environment]);
    tick["game_ended_this_tick"] = json!(true);
    collector.observe(&tick, 0).unwrap();
    tick["combat"]["damage"] = json!([damage(1)]);
    collector.observe(&tick, 1).unwrap();
    let product = collector.product().unwrap();
    assert_eq!(product["shots"][0]["shots_hit"], 0);
    assert_eq!(product["damage"].as_array().unwrap().len(), 3);
}

#[test]
fn unsupported_zero_partial_and_capped_are_independent() {
    let mut collector = Combat::default();
    let mut tick = frame();
    tick.as_object_mut().unwrap().remove("combat");
    collector.observe(&tick, 0).unwrap();
    assert_eq!(collector.product().unwrap()["shot_coverage"]["status"], "unavailable");
    let mut collector = Combat::default();
    let mut tick = frame();
    tick["combat"]["coverage"] = json!([2,0,1,0]);
    collector.observe(&tick, 0).unwrap();
    let product = collector.product().unwrap();
    assert_eq!(product["shot_coverage"]["reason"], "capped");
    assert_eq!(product["damage_coverage"]["status"], "complete");
    assert_eq!(product["death_coverage"]["status"], "partial");
    assert_eq!(product["award_coverage"]["status"], "complete");
}

#[test]
fn malformed_lineage_coordinates_and_catalogues_fail_closed() {
    for case in 0..5 {
        let mut collector = Combat::default();
        let mut tick = frame();
        tick["combat"]["shots"] = json!([shot()]);
        tick["combat"]["damage"] = json!([damage(1)]);
        tick["combat"]["deaths"] = json!([death(1)]);
        match case {
            0 => tick["combat"]["damage"][0]["attacker_slot"] = json!(2),
            1 => tick["combat"]["deaths"][0]["victim_position"] = json!([1e7, 0.0, 0.0]),
            2 => tick["combat"]["shots"][0]["slot_index"] = json!(3),
            3 => tick["combat"]["shots"][0]["weapon_id"] = json!("missing"),
            _ => tick["combat"]["damage"][0]["shield_damage"] = json!(-1.0),
        }
        assert!(collector.observe(&tick, 0).is_err());
    }
}

#[test]
fn capped_deaths_keep_order_and_fit_the_serialized_byte_budget() {
    let mut collector = Combat::default();
    let mut tick = frame();
    tick["combat"]["deaths"] = json!((0..64).map(|_| death(1)).collect::<Vec<_>>());
    for ordinal in 0..150 {
        collector.observe(&tick, ordinal).unwrap();
    }
    let product = collector.product().unwrap();
    assert!(serde_json::to_vec(&product).unwrap().len() <= MAX_BYTES);
    assert_eq!(product["death_coverage"]["reason"], "capped");
    assert!(product["deaths"].as_array().unwrap().len() < 8192);
    assert_eq!(product["shot_coverage"]["status"], "complete");
}

#[test]
fn late_lineage_and_missing_frames_never_claim_complete_zeros() {
    let mut collector = Combat::default();
    let mut tick = frame();
    tick["combat"]["damage"] = json!([damage(1)]);
    collector.observe(&tick, 0).unwrap();
    assert_eq!(collector.product().unwrap()["shot_coverage"]["status"], "partial");
    let mut collector = Combat::default();
    tick.as_object_mut().unwrap().remove("combat");
    collector.observe(&tick, 0).unwrap();
    collector.observe(&frame(), 1).unwrap();
    assert_eq!(collector.product().unwrap()["damage_coverage"]["status"], "partial");
}

#[test]
fn network_and_late_start_coverage_remain_explicit() {
    let mut collector = Combat::new(true);
    collector.observe(&frame(), 0).unwrap();
    let product = collector.product().unwrap();
    assert_eq!(product["shot_coverage"]["reason"], "missing_evidence");
    assert_eq!(product["damage_coverage"]["reason"], "missing_evidence");
    assert_eq!(product["death_coverage"]["status"], "complete");
    let mut collector = Combat::default();
    let mut tick = frame();
    tick["current_tick"] = json!(120);
    collector.observe(&tick, 0).unwrap();
    assert_eq!(collector.product().unwrap()["death_coverage"]["reason"], "partial_recording");
    let mut collector = Combat::default();
    tick["game_ended_this_tick"] = json!(true);
    collector.observe(&tick, 0).unwrap();
    assert_eq!(collector.product().unwrap()["death_coverage"]["reason"], "missing_evidence");
}
