# Verified recovery for recorded client POVs

Exporter 46 adds a second playback attempt for source-pinned format-3 Beta 6, 7 and 8 embedded client films. The worker first runs the ordinary exporter to completion and retains its exact desynchronization verdict. The retry requires a matching nonzero match ID, recorder slot and local-player mask, matching original recorder names, and an uncapped account belonging to the recorder.

The retry reads the recorded host pistol and sniper autoaim fields only when one differs from the saved client settings. For every nongrenade round it consumes the ordinary firing RNG and spread calculation, then binds the recorder's original projectile direction by client tick, trigger, pellet, weapon and projectile tag. Missing or ambiguous bindings, incomplete recordings, refused network updates, failed world hashes and roster mismatches keep the original unavailable result. Both the pinned source-rate simulation and the ordinary playable-world encoder must pass.

Each verified world carries its own clock, roster and source film hash. Its match container includes a small hashed receipt under the client's verification directory. The receipt records the original failure, both settings pairs, the original account digest, verified network application count, and the numbers of matched and changed directions. A difference count of zero identifies a settings-only recovery. The API binds the receipt digest into the selected artifact proof. The viewer verifies that receipt and displays **Recovered POV** next to the recorder's name in the perspective menu. Shooter statistics continue to use the original recording evidence and its original verification boundary.

## Building and rollback

Use the exporter 45 build flags for the appropriate pinned engine plus `-VerifiedPovRecovery` in `tools/build-engine.ps1`. Native parity builds use `-DH1_VERIFIED_POV_RECOVERY=ON`. The recovery input is internal to the second embedded-client invocation. Preserve the old exporters, match v9 reader and every selected or archived generation when rolling back the default. The original evidence and historical replay bytes remain available for review.
