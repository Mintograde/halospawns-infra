use crate::Result;
use glam::{DMat3, DQuat, DVec3};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type Node = [f64; 13];
pub type Pose = Vec<Node>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub space: String,
    pub smallest_three: bool,
    pub closed_loop: bool,
    pub translation_step: f64,
    pub quaternion_levels: f64,
    pub scale_step: f64,
    pub point_error_limit: f64,
    pub point_radius: f64,
}
impl Settings {
    pub fn preset(name: &str) -> Result<Self> {
        let (mode, quality) = name
            .split_once('-')
            .ok_or("expected space-quality preset")?;
        let smallest_three = mode.ends_with('3');
        let mode = mode.strip_suffix('3').unwrap_or(mode);
        let closed_loop = mode != "local";
        let space = if mode == "local" { "hierarchy" } else { mode };
        let (t, q, limit) = match quality {
            "fine" => (65536., 131071., 0.0002),
            "tight" => (65536., 32767., 0.0002),
            "balanced" => (4096., 32767., 0.0006),
            "small" => (1024., 8191., 0.0025),
            _ => return Err("unknown quality".into()),
        };
        let s = Self {
            space: space.into(),
            smallest_three,
            closed_loop,
            translation_step: 1. / t,
            quaternion_levels: q,
            scale_step: 1. / 65536.,
            point_error_limit: limit,
            point_radius: 1.,
        };
        s.validate()?;
        Ok(s)
    }
    pub fn validate(&self) -> Result<()> {
        if !["world", "root", "hierarchy"].contains(&self.space.as_str())
            || ![
                self.translation_step,
                self.quaternion_levels,
                self.scale_step,
                self.point_error_limit,
                self.point_radius,
            ]
            .iter()
            .all(|v| v.is_finite() && *v > 0.)
            || self.quaternion_levels > 1e6
            || self.translation_step < 1e-9
            || self.scale_step < 1e-9
            || self.point_radius > 100.
            || self.point_error_limit > 1.
        {
            return Err("invalid pose settings".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Skeleton {
    pub tag: String,
    pub parents: Vec<i32>,
    pub names: Vec<String>,
    #[serde(default)]
    pub source_glb_sha256: String,
    #[serde(default)]
    pub model_path: String,
}
pub fn order(parents: &[i32]) -> Result<Vec<usize>> {
    if parents.is_empty() || parents.len() > 64 {
        return Err("invalid skeleton size".into());
    }
    let mut sorted = Vec::new();
    let mut done = vec![false; parents.len()];
    while sorted.len() < parents.len() {
        let before = sorted.len();
        for (i, &p) in parents.iter().enumerate() {
            if p < -1 || p >= parents.len() as i32 || p == i as i32 {
                return Err("invalid parent".into());
            }
            if !done[i] && (p == -1 || done[p as usize]) {
                done[i] = true;
                sorted.push(i);
            }
        }
        if sorted.len() == before {
            return Err("cyclic skeleton".into());
        }
    }
    Ok(sorted)
}
pub fn parents(tag: &str, count: usize, s: &Settings, rigs: &[Skeleton]) -> Result<Vec<i32>> {
    match s.space.as_str() {
        "world" => Ok(vec![-1; count]),
        "root" => Ok((0..count).map(|i| if i == 0 { -1 } else { 0 }).collect()),
        _ => {
            let found: Vec<_> = rigs
                .iter()
                .filter(|r| r.tag == tag && r.parents.len() == count)
                .collect();
            if found.len() != 1 {
                return Err(format!("missing or ambiguous skeleton: {tag}, {count} nodes").into());
            }
            order(&found[0].parents)?;
            Ok(found[0].parents.clone())
        }
    }
}
pub fn read_pose(value: &Value) -> Result<Pose> {
    value
        .as_array()
        .ok_or("pose not array")?
        .iter()
        .map(|v| {
            let a = v.as_array().ok_or("node not array")?;
            if a.len() != 13 {
                return Err("node is not 13 components".into());
            }
            let mut n = [0.; 13];
            for (o, v) in n.iter_mut().zip(a) {
                *o = v.as_f64().ok_or("node not numeric")?;
                if !o.is_finite() {
                    return Err("nonfinite node".into());
                }
            }
            Ok(n)
        })
        .collect()
}
pub fn origin(player: &Value) -> DVec3 {
    let b = &player["player_object_data"];
    DVec3::new(
        b["x"].as_f64().unwrap_or(0.),
        b["y"].as_f64().unwrap_or(0.),
        b["z"].as_f64().unwrap_or(0.),
    )
}
fn matrix(n: &Node) -> DMat3 {
    DMat3::from_cols_array(n[4..].try_into().unwrap())
}
fn position(n: &Node) -> DVec3 {
    DVec3::from_slice(&n[..3])
}

#[derive(Clone, Copy)]
struct Transform {
    p: DVec3,
    q: DQuat,
    s: f64,
}
impl Transform {
    fn from_node(n: &Node) -> Option<Self> {
        let m = matrix(n);
        if m.determinant() <= 0. || n[3].abs() < 1e-10 {
            return None;
        }
        let x = m.x_axis.try_normalize()?;
        let y = (m.y_axis - x * x.dot(m.y_axis)).try_normalize()?;
        let q = DQuat::from_mat3(&DMat3::from_cols(x, y, x.cross(y))).normalize();
        Some(Self {
            p: position(n),
            q,
            s: n[3],
        })
    }
    fn node(self) -> Node {
        let mut n = [0.; 13];
        n[..3].copy_from_slice(&self.p.to_array());
        n[3] = self.s;
        n[4..].copy_from_slice(&DMat3::from_quat(self.q).to_cols_array());
        // Match the float32 matrix consumers; validation includes this rounding.
        n.map(|v| v as f32 as f64)
    }
}
fn quant(v: f64, step: f64) -> Option<i32> {
    let x = (v / step).round();
    if !x.is_finite() || x < i32::MIN as f64 || x > i32::MAX as f64 {
        None
    } else {
        Some(x as i32)
    }
}
fn local_decode(v: &[i32; 8], s: &Settings) -> Option<Transform> {
    let q = if s.smallest_three {
        if !(0..4).contains(&v[7]) {
            return None;
        }
        let mut a = [0.; 4];
        let mut j = 4;
        for (i, x) in a.iter_mut().enumerate() {
            if i != v[7] as usize {
                *x = v[j] as f64 / (s.quaternion_levels * std::f64::consts::SQRT_2);
                j += 1;
            }
        }
        let sum = a.iter().map(|v| v * v).sum::<f64>();
        if sum > 1. {
            return None;
        }
        a[v[7] as usize] = (1. - sum).sqrt();
        DQuat::from_array(a)
    } else {
        DQuat::from_array([v[4], v[5], v[6], v[7]].map(|v| v as f64 / s.quaternion_levels))
    };
    if q.length_squared() < 1e-12 {
        return None;
    }
    Some(Transform {
        p: DVec3::new(v[0] as f64, v[1] as f64, v[2] as f64) * s.translation_step,
        s: v[3] as f64 * s.scale_step,
        q: q.normalize(),
    })
}
fn compose(local: Transform, parent: Transform) -> Transform {
    Transform {
        p: parent.p + parent.q * (local.p * parent.s),
        q: (parent.q * local.q).normalize(),
        s: parent.s * local.s,
    }
}
pub fn reconstruct(
    values: &[[i32; 8]],
    parents: &[i32],
    origin: DVec3,
    s: &Settings,
) -> Result<Pose> {
    if values.len() != parents.len() || !origin.is_finite() {
        return Err("invalid pose reconstruction input".into());
    }
    let base = Transform {
        p: origin,
        q: DQuat::IDENTITY,
        s: 1.,
    };
    let mut world = vec![base; values.len()];
    for i in order(parents)? {
        let parent = if parents[i] < 0 {
            base
        } else {
            world[parents[i] as usize]
        };
        world[i] = compose(
            local_decode(&values[i], s).ok_or("invalid quantized quaternion")?,
            parent,
        );
    }
    let nodes: Pose = world.into_iter().map(Transform::node).collect();
    if nodes.iter().flatten().any(|v| !v.is_finite()) {
        return Err("nonfinite reconstructed pose".into());
    }
    Ok(nodes)
}
pub fn point_bound(a: &Node, b: &Node, radius: f64) -> f64 {
    let d = matrix(a) * a[3] - matrix(b) * b[3];
    position(a).distance(position(b))
        + radius * d.to_cols_array().iter().map(|x| x * x).sum::<f64>().sqrt()
}

pub(crate) struct Reconstructor {
    parents: Vec<i32>,
    order: Vec<usize>,
    world: Vec<Transform>,
    nodes: Pose,
}

impl Reconstructor {
    pub(crate) fn new(parents: &[i32]) -> Result<Self> {
        Ok(Self {
            parents: parents.to_vec(),
            order: order(parents)?,
            world: vec![
                Transform {
                    p: DVec3::ZERO,
                    q: DQuat::IDENTITY,
                    s: 1.
                };
                parents.len()
            ],
            nodes: vec![[0.; 13]; parents.len()],
        })
    }

    pub(crate) fn reconstruct(
        &mut self,
        values: &[[i32; 8]],
        origin: DVec3,
        settings: &Settings,
    ) -> Result<&[Node]> {
        if values.len() != self.parents.len() || !origin.is_finite() {
            return Err("invalid pose reconstruction input".into());
        }
        let base = Transform {
            p: origin,
            q: DQuat::IDENTITY,
            s: 1.,
        };
        for &index in &self.order {
            let parent = if self.parents[index] < 0 {
                base
            } else {
                self.world[self.parents[index] as usize]
            };
            self.world[index] = compose(
                local_decode(&values[index], settings).ok_or("invalid quantized quaternion")?,
                parent,
            );
            self.nodes[index] = self.world[index].node();
        }
        if self.nodes.iter().flatten().any(|value| !value.is_finite()) {
            return Err("nonfinite reconstructed pose".into());
        }
        Ok(&self.nodes)
    }
}

pub fn quantize(
    pose: &[Node],
    parents: &[i32],
    origin: DVec3,
    s: &Settings,
    previous: &mut Vec<DQuat>,
) -> Option<Vec<[i32; 8]>> {
    Quantizer::new(parents)
        .ok()?
        .quantize(pose, origin, s, previous)
}

pub(crate) struct Quantizer {
    parents: Vec<i32>,
    order: Vec<usize>,
    decoded: Vec<Transform>,
    source: Vec<Transform>,
}

impl Quantizer {
    pub(crate) fn new(parents: &[i32]) -> Result<Self> {
        let base = Transform {
            p: DVec3::ZERO,
            q: DQuat::IDENTITY,
            s: 1.,
        };
        Ok(Self {
            parents: parents.to_vec(),
            order: order(parents)?,
            decoded: vec![base; parents.len()],
            source: vec![base; parents.len()],
        })
    }

    pub(crate) fn quantize(
        &mut self,
        pose: &[Node],
        origin: DVec3,
        settings: &Settings,
        previous: &mut Vec<DQuat>,
    ) -> Option<Vec<[i32; 8]>> {
        if pose.len() != self.parents.len() || !origin.is_finite() {
            return None;
        }
        let base = Transform {
            p: origin,
            q: DQuat::IDENTITY,
            s: 1.,
        };
        let mut values = vec![[0; 8]; pose.len()];
        if previous.len() != pose.len() {
            *previous = vec![DQuat::IDENTITY; pose.len()];
        }
        for &index in &self.order {
            let target = Transform::from_node(&pose[index])?;
            self.source[index] = target;
            let parent_index = self.parents[index];
            let parent = if parent_index < 0 {
                base
            } else {
                self.decoded[parent_index as usize]
            };
            let reference = if settings.closed_loop || parent_index < 0 {
                parent
            } else {
                self.source[parent_index as usize]
            };
            if parent.s.abs() < 1e-10 {
                return None;
            }
            let local_position = reference.q.conjugate() * (target.p - reference.p) / reference.s;
            let mut local_rotation = (reference.q.conjugate() * target.q).normalize();
            if local_rotation.dot(previous[index]) < 0. {
                local_rotation = -local_rotation;
            }
            let local_scale = target.s / reference.s;
            let position = local_position.to_array();
            let rotation = local_rotation.to_array();
            for axis in 0..3 {
                values[index][axis] = quant(position[axis], settings.translation_step)?;
            }
            values[index][3] = quant(local_scale, settings.scale_step)?;
            if settings.smallest_three {
                let omitted = (0..4).max_by(|left, right| {
                    rotation[*left].abs().total_cmp(&rotation[*right].abs())
                })?;
                let sign = if rotation[omitted] < 0. { -1. } else { 1. };
                let mut channel = 4;
                for (axis, value) in rotation.iter().enumerate() {
                    if axis != omitted {
                        values[index][channel] = quant(
                            value * sign,
                            1. / (settings.quaternion_levels * std::f64::consts::SQRT_2),
                        )?;
                        channel += 1;
                    }
                }
                values[index][7] = omitted as i32;
            } else {
                for axis in 0..4 {
                    values[index][4 + axis] =
                        quant(rotation[axis], 1. / settings.quaternion_levels)?;
                }
            }
            let local = local_decode(&values[index], settings)?;
            self.decoded[index] = compose(local, parent);
            let bound = point_bound(
                &pose[index],
                &self.decoded[index].node(),
                settings.point_radius,
            );
            if !bound.is_finite() || bound > settings.point_error_limit {
                return None;
            }
            previous[index] = local_rotation;
        }
        Some(values)
    }
}

#[derive(Default, Serialize)]
pub struct ErrorStats {
    pub nodes: u64,
    pub max_position: f64,
    pub sum_squared_position: f64,
    pub max_angle_degrees: f64,
    pub max_point_bound: f64,
    pub max_component: f64,
    pub node_max_position: BTreeMap<usize, f64>,
    pub node_max_point_bound: BTreeMap<usize, f64>,
}
impl ErrorStats {
    pub fn observe(&mut self, a: &Pose, b: &Pose, radius: f64) -> Result<()> {
        if a.len() != b.len() {
            return Err("node count changed".into());
        }
        for (i, (a, b)) in a.iter().zip(b).enumerate() {
            let p = position(a).distance(position(b));
            let bound = point_bound(a, b, radius);
            self.nodes += 1;
            self.max_position = self.max_position.max(p);
            self.sum_squared_position += p * p;
            self.max_point_bound = self.max_point_bound.max(bound);
            if let (Some(a), Some(b)) = (Transform::from_node(a), Transform::from_node(b)) {
                let angle = 2. * a.q.dot(b.q).abs().min(1.).acos().to_degrees();
                self.max_angle_degrees = self.max_angle_degrees.max(angle);
            }
            for (a, b) in a.iter().zip(b) {
                self.max_component = self.max_component.max((a - b).abs());
            }
            let e = self.node_max_position.entry(i).or_default();
            *e = e.max(p);
            let e = self.node_max_point_bound.entry(i).or_default();
            *e = e.max(bound);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reused_quantizer_matches_fresh_state_after_fallbacks_and_origin_changes() {
        for preset in [
            "local3-fine",
            "hierarchy-balanced",
            "root3-tight",
            "world-small",
        ] {
            let settings = Settings::preset(preset).unwrap();
            let parents = [-1, 2, 0, 2];
            let mut quantizer = Quantizer::new(&parents).unwrap();
            let mut reconstructor = Reconstructor::new(&parents).unwrap();
            let mut previous = Vec::new();
            let mut reference_previous = Vec::new();
            for frame in 0..128 {
                let origin = DVec3::new(frame as f64 / 16., -2., 3.);
                let mut source: Pose = (0..4)
                    .map(|index| {
                        Transform {
                            p: origin + DVec3::new(index as f64 / 8., 0., 0.125),
                            q: DQuat::from_rotation_z((frame + index) as f64 / 10.),
                            s: if frame % 13 == 0 { 0.8 } else { 1. },
                        }
                        .node()
                    })
                    .collect();
                if frame % 7 == 0 {
                    source[1][5] += 0.5;
                }
                if frame % 11 == 0 {
                    source[2][3] = 0.;
                }
                let expected = quantize(
                    &source,
                    &parents,
                    origin,
                    &settings,
                    &mut reference_previous,
                );
                let actual = quantizer.quantize(&source, origin, &settings, &mut previous);
                assert_eq!(actual, expected);
                assert_eq!(previous, reference_previous);
                if actual.is_none() {
                    previous.clear();
                    reference_previous.clear();
                } else {
                    let actual = actual.unwrap();
                    let decoded = reconstruct(&actual, &parents, origin, &settings).unwrap();
                    let recycled = reconstructor
                        .reconstruct(&actual, origin, &settings)
                        .unwrap();
                    assert!(
                        decoded
                            .iter()
                            .flatten()
                            .zip(recycled.iter().flatten())
                            .all(|(reference, recycled)| reference.to_bits() == recycled.to_bits())
                    );
                    assert!(
                        source
                            .iter()
                            .zip(&decoded)
                            .all(|(before, after)| point_bound(
                                before,
                                after,
                                settings.point_radius
                            ) <= settings.point_error_limit)
                    );
                }
            }
        }
        assert!(Quantizer::new(&[1, 0]).is_err());
        assert!(Quantizer::new(&[-1, 4]).is_err());
        assert!(Quantizer::new(&[]).is_err());
    }
    #[test]
    fn reconstruction_rejects_mismatched_and_nonfinite_output() {
        let s = Settings::preset("local3-fine").unwrap();
        assert!(reconstruct(&[], &[-1], DVec3::ZERO, &s).is_err());
        let values = vec![[0, 0, 0, i32::MAX, 0, 0, 0, 3]; 64];
        let parents: Vec<i32> = (0..64).map(|i| i - 1).collect();
        assert!(reconstruct(&values, &parents, DVec3::ZERO, &s).is_err());
        let mut recycled = Reconstructor::new(&parents).unwrap();
        assert!(recycled.reconstruct(&values, DVec3::ZERO, &s).is_err());
        assert!(recycled.reconstruct(&[], DVec3::ZERO, &s).is_err());
        assert!(recycled.reconstruct(&values, DVec3::NAN, &s).is_err());
        assert!(Reconstructor::new(&[1, 0]).is_err());
        assert!(Reconstructor::new(&[-1, 4]).is_err());
    }
    #[test]
    fn hierarchy_rotation_scale_and_translation() {
        let s = Settings::preset("hierarchy-balanced").unwrap();
        let p = vec![-1, 2, 0];
        let mut previous = Vec::new();
        for t in 0..300 {
            let root = Transform {
                p: DVec3::new(30., -20., 1. + t as f64 / 100.),
                q: DQuat::from_rotation_z(t as f64 / 20.),
                s: 1.2,
            };
            let limb = compose(
                Transform {
                    p: DVec3::new(0.1, 0.2, 0.3),
                    q: DQuat::from_rotation_x(0.7),
                    s: 0.9,
                },
                root,
            );
            let tip = compose(
                Transform {
                    p: DVec3::new(0.4, 0., 0.1),
                    q: DQuat::from_rotation_y(1.3),
                    s: 1.,
                },
                limb,
            );
            let original = vec![root.node(), tip.node(), limb.node()];
            let q = quantize(&original, &p, root.p, &s, &mut previous).unwrap();
            let restored = reconstruct(&q, &p, root.p, &s).unwrap();
            for (a, b) in original.iter().zip(&restored) {
                assert!(point_bound(a, b, 1.) <= s.point_error_limit);
            }
        }
    }
    #[test]
    fn shear_and_reflection_fall_back() {
        let s = Settings::preset("root-balanced").unwrap();
        let mut n = Transform {
            p: DVec3::ZERO,
            q: DQuat::IDENTITY,
            s: 1.,
        }
        .node();
        n[5] = 0.2;
        assert!(quantize(&vec![n], &[-1], DVec3::ZERO, &s, &mut vec![]).is_none());
        n[5] = 0.;
        n[4] = -1.;
        assert!(quantize(&vec![n], &[-1], DVec3::ZERO, &s, &mut vec![]).is_none());
    }
    #[test]
    fn rejects_cycles() {
        assert!(order(&[1, 0]).is_err());
        assert!(order(&[-1, 2]).is_err());
    }
}
