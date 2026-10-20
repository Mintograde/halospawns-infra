use super::*;
use crate::transport::{ObjectState, PoseState};

struct Frame {
    tick: Value,
    objects: ObjectState,
    poses: PoseState,
    incremental: bool,
    typed: bool,
}

impl Default for Frame {
    fn default() -> Self {
        Self {
            tick: Value::Null,
            objects: ObjectState::default(),
            poses: PoseState::default(),
            incremental: false,
            typed: false,
        }
    }
}

pub struct IncrementalWorker {
    sender: Option<SyncSender<Vec<Frame>>>,
    returned: mpsc::Receiver<Vec<Frame>>,
    pending: Vec<Frame>,
    spares: Vec<Frame>,
    allocated: usize,
    worker: Option<JoinHandle<Result<StreamingExport, String>>>,
    incremental: bool,
    typed: bool,
    cached_spawns: bool,
}

impl IncrementalWorker {
    const BATCH: usize = 2;
    const FRAMES: usize = 3 * Self::BATCH;

    pub fn new(directory: &Path, expected: usize, level: i32) -> Result<Self, Box<dyn Error>> {
        let mut export = StreamingExport::new(directory, expected, level)?;
        let incremental = export.supports_incremental();
        let typed = export.supports_typed_poses();
        let cached_spawns = export.supports_cached_spawns();
        let (sender, receiver) = mpsc::sync_channel::<Vec<Frame>>(1);
        let (recycle, returned) = mpsc::channel();
        let worker = thread::spawn(move || {
            for mut frames in receiver {
                for frame in &mut frames {
                    let result = if frame.incremental {
                        export.push_incremental_source(
                            &mut frame.tick,
                            &frame.objects,
                            frame.typed.then_some(&frame.poses),
                        )
                    } else {
                        export.push_transport_source(&mut frame.tick)
                    };
                    result.map_err(|error| error.to_string())?;
                    frame.objects.release_snapshot();
                }
                if recycle.send(frames).is_err() {
                    return Err("encoder recycle channel closed".into());
                }
            }
            Ok(export)
        });
        Ok(Self {
            sender: Some(sender),
            returned,
            pending: Vec::with_capacity(Self::BATCH),
            spares: Vec::new(),
            allocated: 0,
            worker: Some(worker),
            incremental,
            typed,
            cached_spawns,
        })
    }

    pub fn supports_incremental(&self) -> bool {
        self.incremental
    }
    pub fn supports_typed_poses(&self) -> bool {
        self.typed
    }
    pub fn supports_cached_spawns(&self) -> bool {
        self.cached_spawns
    }

    fn failure(&mut self) -> Box<dyn Error> {
        self.sender.take();
        match self.worker.take().map(JoinHandle::join) {
            Some(Ok(Err(error))) => error.into(),
            Some(Err(_)) => "encoder pipeline panicked".into(),
            _ => "encoder pipeline closed early".into(),
        }
    }

    fn acquire(&mut self) -> Result<Frame, Box<dyn Error>> {
        if self.spares.is_empty() {
            if let Ok(frames) = self.returned.try_recv() {
                self.spares = frames;
            } else if self.allocated < Self::FRAMES {
                self.allocated += 1;
                return Ok(Frame::default());
            } else {
                self.spares = self.returned.recv().map_err(|_| self.failure())?;
            }
        }
        self.spares
            .pop()
            .ok_or_else(|| "missing recycled frame".into())
    }

    fn flush(&mut self) -> Result<(), Box<dyn Error>> {
        if !self.pending.is_empty() {
            let frames = std::mem::replace(&mut self.pending, Vec::with_capacity(Self::BATCH));
            if self
                .sender
                .as_ref()
                .ok_or("encoder pipeline closed")?
                .send(frames)
                .is_err()
            {
                return Err(self.failure());
            }
        }
        Ok(())
    }

    fn push(
        &mut self,
        tick: &mut Value,
        objects: Option<&ObjectState>,
        poses: Option<&PoseState>,
    ) -> Result<(), Box<dyn Error>> {
        let mut frame = self.acquire()?;
        std::mem::swap(tick, &mut frame.tick);
        frame.incremental = objects.is_some();
        frame.typed = poses.is_some();
        if let Some(objects) = objects {
            objects.snapshot_into(&mut frame.objects);
        }
        if let Some(poses) = poses {
            poses.snapshot_into(&mut frame.poses);
        }
        self.pending.push(frame);
        if self.pending.len() == Self::BATCH {
            self.flush()?;
        }
        Ok(())
    }

    pub fn push_transport_source(&mut self, tick: &mut Value) -> Result<(), Box<dyn Error>> {
        self.push(tick, None, None)
    }

    pub fn push_incremental_source(
        &mut self,
        tick: &mut Value,
        objects: &ObjectState,
        poses: Option<&PoseState>,
    ) -> Result<(), Box<dyn Error>> {
        self.push(tick, Some(objects), poses)
    }

    pub fn finish(
        mut self,
        metadata: &Map<String, Value>,
        output: &Path,
        replay_id: &str,
        recorded_at: &str,
    ) -> Result<ContainerResult, Box<dyn Error>> {
        self.flush()?;
        self.sender.take();
        self.worker
            .take()
            .ok_or("encoder pipeline already failed")?
            .join()
            .map_err(|_| "encoder pipeline panicked")??
            .finish(metadata, output, replay_id, recorded_at)
    }
}

impl Drop for IncrementalWorker {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_worker_propagates_invalid_short_and_long_streams() {
        let root = std::env::temp_dir().join(format!(
            "h1-incremental-pipeline-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        for (name, total, expected, invalid) in [
            ("invalid", 100, 100, true),
            ("short", 7, 8, false),
            ("long", 9, 8, false),
        ] {
            let mut worker = IncrementalWorker::new(&root.join(name), expected, 1).unwrap();
            for _ in 0..total {
                let mut tick = if invalid {
                    serde_json::json!({"players":"wrong"})
                } else {
                    serde_json::json!({})
                };
                if worker.push_transport_source(&mut tick).is_err() {
                    break;
                }
                assert!(worker.allocated <= IncrementalWorker::FRAMES);
            }
            let output = root.join(format!("{name}.hsrdc"));
            assert!(
                worker
                    .finish(&Map::new(), &output, "test", "2026-10-19T00:00:00Z")
                    .is_err()
            );
            assert!(!output.exists());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
