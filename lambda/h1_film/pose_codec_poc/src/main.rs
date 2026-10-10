mod legacy;
mod pose;
mod wire;
use legacy::{Builder, Container, Result};
use pose::{ErrorStats, Settings, Skeleton};
use serde_json::{Value, json};
use std::{env, fs, path::Path, time::Instant};

const MAGIC: &[u8; 8] = b"H1POSE01";
const SOURCE: &[u8; 8] = b"HSRDC001";

fn compare(
    source: &[Value],
    restored: &[Value],
    settings: &Settings,
    stats: &mut ErrorStats,
) -> Result<()> {
    if source.len() != restored.len() {
        return Err("tick count changed".into());
    }
    for (a, b) in source.iter().zip(restored) {
        let ap = a["players"].as_array().ok_or("source players missing")?;
        let bp = b["players"].as_array().ok_or("decoded players missing")?;
        if ap.len() != bp.len() {
            return Err("player count changed".into());
        }
        for (a, b) in ap.iter().zip(bp) {
            if a.as_object().ok_or("player not object")?.len()
                != b.as_object().ok_or("player not object")?.len()
            {
                return Err("player keys changed".into());
            }
            for (key, value) in a.as_object().unwrap() {
                if key != "model_nodes" && !b.get(key).is_some_and(|v| legacy::equal(value, v)) {
                    return Err("non-pose player field changed".into());
                }
            }
            if a["model_nodes"].as_array().is_some_and(|v| !v.is_empty()) {
                stats.observe(
                    &pose::read_pose(&a["model_nodes"])?,
                    &pose::read_pose(&b["model_nodes"])?,
                    settings.point_radius,
                )?;
            } else if !legacy::equal(&a["model_nodes"], &b["model_nodes"]) {
                return Err("empty pose changed".into());
            }
        }
        if a.as_object().unwrap().len() != b.as_object().unwrap().len() {
            return Err("tick keys changed".into());
        }
        for (key, value) in a.as_object().unwrap() {
            if key != "players" && !b.get(key).is_some_and(|v| legacy::equal(value, v)) {
                return Err("non-pose tick field changed".into());
            }
        }
    }
    if stats.max_point_bound > settings.point_error_limit * (1. + 1e-8) {
        return Err("pose error limit exceeded".into());
    }
    Ok(())
}
fn verify(input: &Path, output: &Path) -> Result<Value> {
    let start = Instant::now();
    let mut source = Container::open(input, SOURCE)?;
    let mut candidate = Container::open(output, MAGIC)?;
    if candidate.manifest["format"] != "halospawns.poseCodecExperiment.v1"
        || candidate.manifest["sourceSha256"].as_str() != Some(&legacy::file_hash(input)?)
        || candidate.manifest["sourceManifest"] != source.manifest
    {
        return Err("source identity mismatch".into());
    }
    let settings: Settings = serde_json::from_value(candidate.manifest["settings"].clone())?;
    settings.validate()?;
    if source.manifest["chunks"].as_array().unwrap().len()
        != candidate.manifest["chunks"].as_array().unwrap().len()
    {
        return Err("chunk count mismatch".into());
    }
    let mut stats = ErrorStats::default();
    let mut ticks = 0;
    // Deliberately visit chunks backwards: reconstruction must not inherit earlier state.
    for i in (0..source.manifest["chunks"].as_array().unwrap().len()).rev() {
        let (a, original) = legacy::decode(&source.chunk(i)?)?;
        let (b, restored) = wire::unpack(&candidate.chunk(i)?, &settings)?;
        if a != b
            || b as u64
                != candidate.manifest["chunks"][i]["firstTick"]
                    .as_u64()
                    .unwrap()
            || restored.len() as u64
                != candidate.manifest["chunks"][i]["tickCount"]
                    .as_u64()
                    .unwrap()
        {
            return Err("chunk coverage changed".into());
        }
        compare(&original, &restored, &settings, &mut stats)?;
        ticks += restored.len();
    }
    Ok(
        json!({"all_non_pose_fields_exact":true,"reverse_chunk_seeks_passed":true,"ticks":ticks,"errors":stats,"seconds":start.elapsed().as_secs_f64()}),
    )
}
fn pack(
    input: &Path,
    output: &Path,
    preset: &str,
    rigs: &[Skeleton],
    max_chunks: Option<usize>,
) -> Result<Value> {
    let start = Instant::now();
    let mut source = Container::open(input, SOURCE)?;
    let settings = Settings::preset(preset)?;
    let mut builder = Builder::new(output)?;
    let mut counts = wire::Counts::default();
    let mut stats = ErrorStats::default();
    let total = source.manifest["chunks"].as_array().unwrap().len();
    let n = max_chunks.unwrap_or(total).min(total);
    let mut ticks_seen = 0;
    let mut original_chunk_bytes = 0;
    for i in 0..n {
        let raw = source.chunk(i)?;
        let (first, ticks) = legacy::decode(&raw)?;
        if first != ticks_seen
            || ticks.len() as u64 != source.manifest["chunks"][i]["tickCount"].as_u64().unwrap()
        {
            return Err("source coverage mismatch".into());
        }
        let (block, c) = wire::pack(&ticks, first, &settings, rigs)?;
        counts.add(&c);
        let (read_first, restored) = wire::unpack(&block, &settings)?;
        if read_first != first {
            return Err("pose first tick mismatch".into());
        }
        compare(&ticks, &restored, &settings, &mut stats)?;
        builder.add(&block, first, ticks.len(), "")?;
        ticks_seen += ticks.len();
        original_chunk_bytes += source.manifest["chunks"][i]["compressedBytes"]
            .as_u64()
            .unwrap();
        eprintln!(
            "{preset}: chunk {}/{n}, {} ticks, {:.1}s",
            i + 1,
            ticks_seen,
            start.elapsed().as_secs_f64()
        );
    }
    let manifest = json!({"format":"halospawns.poseCodecExperiment.v1","settings":settings,
        "sourceSha256":legacy::file_hash(input)?,"sourceManifest":source.manifest,
        "tickCount":ticks_seen,"chunks":[],"partial":n!=total,"skeletons":rigs});
    let bytes = builder.finish(output, MAGIC, manifest)?;
    let encoding_seconds = start.elapsed().as_secs_f64();
    let readback = if n == total {
        verify(input, output)?
    } else {
        json!({"partial":true,"full_file_readback":false})
    };
    let report = json!({"schema":"halospawns.poseCodecPocReport.v1","input":input,"output":output,"preset":preset,
        "settings":settings,"input_bytes":source.bytes,"output_bytes":bytes,
        "ratio":if n==total{source.bytes as f64/bytes as f64}else{0.},"partial":n!=total,
        "source_chunk_bytes":original_chunk_bytes,"ticks":ticks_seen,"counts":counts,"errors":stats,
        "encoding_and_inline_validation_seconds":encoding_seconds,"readback":readback,
        "output_sha256":legacy::file_hash(output)?});
    let report_path = output.with_extension("report.json");
    let report_file = fs::File::options()
        .write(true)
        .create_new(true)
        .open(&report_path)?;
    serde_json::to_writer_pretty(report_file, &report)?;
    Ok(report)
}
fn expand(input: &Path, output: &Path) -> Result<Value> {
    let mut source = Container::open(input, MAGIC)?;
    if source.manifest["partial"] != false {
        return Err("cannot expand partial experiment".into());
    }
    let settings: Settings = serde_json::from_value(source.manifest["settings"].clone())?;
    let mut builder = Builder::new(output)?;
    for i in 0..source.manifest["chunks"].as_array().unwrap().len() {
        let (first, ticks) = wire::unpack(&source.chunk(i)?, &settings)?;
        let raw = legacy::encode(&ticks, first)?;
        let (f, decoded) = legacy::decode(&raw)?;
        if f != first
            || ticks.len() != decoded.len()
            || !ticks.iter().zip(&decoded).all(|(a, b)| legacy::equal(a, b))
        {
            return Err("expanded codec mismatch".into());
        }
        builder.add(&raw, first, ticks.len(), &legacy::tick_hash(&decoded)?)?;
    }
    let bytes = builder.finish(output, SOURCE, source.manifest["sourceManifest"].clone())?;
    Ok(
        json!({"output":output,"bytes":bytes,"note":"Approximate poses expanded for existing offline viewer; not the compact experimental file."}),
    )
}
fn main() -> Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("pack") if (5..=6).contains(&args.len()) => {
            let rigs: Vec<Skeleton> = if args[4] == "-" {
                Vec::new()
            } else {
                serde_json::from_slice(&fs::read(&args[4])?)?
            };
            let limit = args.get(5).map(|v| v.parse()).transpose()?;
            if limit == Some(0) {
                return Err("chunk limit must be positive".into());
            }
            pack(
                Path::new(&args[1]),
                Path::new(&args[2]),
                &args[3],
                &rigs,
                limit,
            )?
        }
        Some("verify") if args.len() == 3 => verify(Path::new(&args[1]), Path::new(&args[2]))?,
        Some("expand") if args.len() == 3 => expand(Path::new(&args[1]), Path::new(&args[2]))?,
        _ => {
            return Err(concat!(
                "Usage: pack INPUT OUTPUT PRESET SKELETONS_JSON_OR_DASH [MAX_CHUNKS] | ",
                "verify SOURCE EXPERIMENT | expand EXPERIMENT APPROXIMATE_HSRDC"
            )
            .into());
        }
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ticks() -> Vec<Value> {
        (0..24).map(|t| {
            let mut node = [0.; 13];
            node[0] = 10. + t as f64 / 120.;
            node[1] = -5.;
            node[3] = 1.; node[4] = 1.; node[8] = 1.; node[12] = 1.;
            let mut child = node;
            child[2] = 0.37;
            child[0] += 0.12;
            if t==7 {child[5]=0.3;}
            let nodes=if t==9{json!([])}else{json!([node,child])};
            let mut p=json!({"player_index":0,"player_object_id":if t<12{77}else{88},"object_ref":if t<12{77}else{88},
                "player_object_data":{"tag_name":"test","x":node[0],"y":-5.,"z":0.,"health":0.75},"model_nodes":nodes,
                "first_person_weapon":{"animation_id":t/4,"animation_tick":t%4},"name":"Example"});
            if t==10 {p.as_object_mut().unwrap().shift_remove("model_nodes");}
            json!({"players":[p],"objects":[{"id":4,"x":0.0}],"tick":t,"glass":[t%2==0]})
        }).collect()
    }
    #[test]
    fn all_modes_preserve_other_fields_lifecycle_and_raw_fallbacks() {
        let ticks = ticks();
        let rigs = vec![Skeleton {
            tag: "test".into(),
            parents: vec![-1, 0],
            names: vec!["root".into(), "child".into()],
            source_glb_sha256: String::new(),
            model_path: String::new(),
        }];
        for name in [
            "world-balanced",
            "root-small",
            "hierarchy-tight",
            "hierarchy3-tight",
            "local-tight",
            "local3-balanced",
            "local3-fine",
        ] {
            let settings = Settings::preset(name).unwrap();
            let (block, counts) = wire::pack(&ticks, 2048, &settings, &rigs).unwrap();
            assert!(counts.raw_poses >= 1);
            assert!(counts.runs >= 3);
            let (first, decoded) = wire::unpack(&block, &settings).unwrap();
            assert_eq!(first, 2048);
            compare(&ticks, &decoded, &settings, &mut ErrorStats::default()).unwrap();
            assert_eq!(
                ticks[7]["players"][0]["model_nodes"],
                decoded[7]["players"][0]["model_nodes"]
            );
            for n in [0, 1, 4, 12, block.len() - 1] {
                assert!(wire::unpack(&block[..n], &settings).is_err());
            }
        }
    }
    #[test]
    fn rejects_missing_skeleton_and_invalid_settings() {
        assert!(
            wire::pack(
                &ticks(),
                0,
                &Settings::preset("hierarchy-tight").unwrap(),
                &[]
            )
            .is_err()
        );
        let mut settings = Settings::preset("root-tight").unwrap();
        settings.quaternion_levels = 0.;
        assert!(settings.validate().is_err());
    }
    #[test]
    fn expansion_hashes_decoded_lifecycle_ticks_and_preserves_sources() {
        let directory = std::env::temp_dir().join(format!(
            "h1-pose-codec-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let input = directory.join("test.h1pc");
        let output = directory.join("test.hsrdc");
        let ticks = ticks();
        let settings = Settings::preset("root-tight").unwrap();
        let (block, _) = wire::pack(&ticks, 0, &settings, &[]).unwrap();
        let mut builder = Builder::new(&input).unwrap();
        builder.add(&block, 0, ticks.len(), "").unwrap();
        builder
            .finish(
                &input,
                MAGIC,
                json!({
                    "format": "halospawns.poseCodecExperiment.v1", "partial": false,
                    "tickCount": ticks.len(), "settings": settings,
                    "sourceManifest": legacy::test_manifest(ticks.len())
                }),
            )
            .unwrap();
        let before = legacy::file_hash(&input).unwrap();
        expand(&input, &output).unwrap();
        let mut artifact = Container::open(&output, SOURCE).unwrap();
        let (first, restored) = legacy::decode(&artifact.chunk(0).unwrap()).unwrap();
        assert_eq!(first, 0);
        assert_eq!(
            artifact.manifest["chunks"][0]["tickSha256"],
            legacy::tick_hash(&restored).unwrap()
        );
        compare(&ticks, &restored, &settings, &mut ErrorStats::default()).unwrap();
        assert_eq!(before, legacy::file_hash(&input).unwrap());
        assert!(expand(&input, &output).is_err());
        assert!(expand(&input, &input).is_err());
        drop(artifact);
        fs::remove_file(output).unwrap();
        fs::remove_file(input).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
