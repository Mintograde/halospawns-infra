use crate::{
    legacy,
    pose::{Settings, Skeleton},
};
pub use h1_pose_codec::wire::Counts;
use serde_json::Value;

struct Codec;
impl h1_pose_codec::BaseCodec for Codec {
    fn encode(&self, ticks: &[Value], first: usize) -> legacy::Result<Vec<u8>> {
        legacy::encode(ticks, first)
    }
    fn decode(&self, bytes: &[u8]) -> legacy::Result<(usize, Vec<Value>)> {
        legacy::decode(bytes)
    }
}
pub fn pack(
    ticks: &[Value],
    first: usize,
    settings: &Settings,
    rigs: &[Skeleton],
) -> legacy::Result<(Vec<u8>, Counts)> {
    h1_pose_codec::wire::pack(ticks, first, settings, rigs, &Codec, false)
}
pub fn unpack(bytes: &[u8], settings: &Settings) -> legacy::Result<(usize, Vec<Value>)> {
    h1_pose_codec::wire::unpack(bytes, settings, &Codec)
}
