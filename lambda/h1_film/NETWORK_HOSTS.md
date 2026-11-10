# Bot-aware network host classification

Exporter 26 adds `halospawns.h1NetworkHostBots.v1` for the pinned Beta 6/7
engines, using the exact retained simulation binaries. Older recipes keep their
original interpretation. The API must support this capability at registration
and activation before the new worker default is promoted.

The FNET damage-owner drop mask identifies remote humans, not all non-host
participants: hosted bots have no remote machine and have no drop bit. A local
lobby `bots` setting is not an actual hosted-bot count. The envelope's own/local
player fields can be rewritten for a downloading client, so they do not identify
the host either. Display names and a `Linux server` label are not host proof.

The reviewed Beta 6/7 source creates local human player datums first, before
`create_remote_players` creates remote humans and hosted bots. With an unchanged
tick-zero roster and drop mask, the host's humans therefore form the initial
prefix. The new parser uses one of these recorded evidence sources:

- A bounded THI1 START item records `blampc_bots_created()` at the first update.
  Its time and world hash must match the first trailer sample. Subtract that
  actual count from the nonremote roster to recover the human host count.
- An HRS1 host-rounds item retains the original host's human local-player mask,
  including when that host fired no rounds. If START is also present, both
  must agree. No viewing-client mask is substituted.
- When slot zero is positively remote, there was no local human host. This
  works on mirrored films that omit the optional items. Any other initial
  nonremote participants are hosted bots.

The derived human count must match the recorded local-seat count, except that
zero humans requires the recorder's one-seat placeholder. Host slots must never
be marked remote. Bot and remote slots must complete the initial roster. Joins
or quits at tick zero, a changed initial mask, nonzero first update, conflicting
evidence or an ambiguous nonremote slot zero produce no host claim. In
particular, one nonremote participant alone does not prove a human host.

The completion's `initial_fnet_bot_roster_v1` evidence carries separate
`host_slots`, `bot_slots` and `roster_evidence`. Zero human hosts means `neutral`;
one to four means `on_off`. Only human host slots receive the Host tag. Later
joiners are not classified by the initial roster proof. API and worker both
validate the partition, evidence kind, supported engine and exporter minimum.
Local games retain their existing `local` classification.

Worthy game `5fd1a62e-6547-41d9-a76e-94575ee67f98` has initial remote mask 49,
initial players 6, and a remote slot zero. Slots 1/2/3 are bots and there are no
human host slots. The viewing client joins as slot 6 later; it is not the host.
The local source hash matches the retained upload. Evidence and rollout checks
are under `.build/host-mode-worthy/`.

Deployed in dev as worker/default `20261110-r4`, policy 24, API 240. Worthy's
authorized full reparse is selected and returns `neutral`; all five worlds and
the entire viewer file are byte-identical to its original generation. Statistics
and recorded settings are unchanged. Desktop/mobile component checks using
live API responses show Neutral and no Host tags. See `DEPLOYMENT.md` for the
immutable release pins, regression corpus and preserved-history audit.
