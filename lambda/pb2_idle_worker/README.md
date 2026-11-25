# PB2 idle game audits

The dev schedule checks newly selected PB2 recordings every two minutes.
The auditor range-reads the original film's host action stream inside the
statistics window. A slot needs more than a minute of uninterrupted quiet
actions before the worker reads its controller or keyboard/mouse samples and
the corresponding chunks of the selected host replay.

The player's recorded input settings distinguish aim and movement from stick
drift. During a quiet stretch, each verified living tick counts once.
Deaths pause the timer. Buttons, triggers, intentional stick or mouse input
reset it, including input while dead. An exact minute stays eligible. A
single player above the threshold excludes the whole game. The API keeps
the slot, frame interval and living tick count for review.

The database binds every result to the game, source film, selected viewer,
recorded rate and statistics bounds. A source change makes the new selection
eligible for audit. Incomplete input, ambiguous slots and network gaps can
produce an unknown result. Only positive evidence excludes a game. The
private API handles leases, retries and aggregate invalidation. Historical
backfills use the same worker as new games.

Run `node --test lambda/pb2_idle_worker/tests/input.test.mjs` from the infra
root. After applying the API migration, deploying the API and provisioning
the dev worker, `scripts/publish-pb2-idle.py` packages the film readers and
the sibling Svelte viewer's existing delta decoder and publishes the dev alias.

The same schedule also reads player input profiles from original, versioned
host, embedded client and selected separate client recordings. This uses
independent leases and a separate evidence table. It reads only the headers,
rosters, raw input and configuration ranges. The public product contains
input method counts and allowlisted settings for identifiable seats.
Historical runs can invoke the worker with `{"task":"inputs"}`. Run both
`tests/input.test.mjs` and `tests/profiles.test.mjs` for the two readers.
