# MCC Workshop map flow

The main flow separates **finding the exact map** from **approving it for replay
processing**. See the [Workshop runbook](WORKSHOP_MAPS.md) for implementation,
deployment, credential setup and rollback details.

## Replay intake and map discovery

```mermaid
flowchart TD
    A["Replay uploaded<br/>Workshop ID in film metadata"] --> B["Record Workshop ID<br/>and original film source"]
    B --> C{"Matching map already<br/>linked to this Workshop ID?"}

    C -- Yes --> J
    C -- No --> D["Save replay as waiting"]
    D --> E["Scheduled Workshop worker<br/>checks Steam and downloads package"]
    E --> F["Extract Halo CE maps<br/>Hash and retain immutable bytes"]
    F --> G{"Exact SHA-256 + size match<br/>to an existing map?"}

    G -- Yes --> H["Reuse existing map<br/>including separately uploaded maps"]
    G -- No --> I["Create map upload<br/>Run existing map-processing pipeline"]

    H --> K["Associate Workshop revision<br/>with map IDs"]
    I --> K
    K --> AA{"Registered H1 film engine<br/>Beta 7 or later?"}
    AA -- Yes --> AB["Automatically approve eligible MCC map<br/>Pin source, GLB and Workshop provenance"]
    AA -- No --> AC["Manual map approval required"]
    AB --> L["Redispatch waiting replay"]
    AC -. "After approval" .-> L
    AB -- "Ambiguous, retired or ineligible" --> P
    L --> J{"Unique approved map binding<br/>for the recorded engine?"}

    J -- Yes --> M["Freeze exact map and engine versions"]
    M --> N["Simulate and verify replay"]
    N --> O["Publish game and viewer<br/>with Workshop source link"]

    J -- "Approval missing" --> P["Keep replay waiting<br/>for map review"]
    P -. "After approval" .-> L
    J -- "Multiple matches" --> Q["Flag ambiguity for review"]

    E -- "Download unavailable" --> R["Keep pending<br/>Retry with backoff"]
    R -.-> E

    classDef waiting fill:#fff3cd,stroke:#b8860b,color:#222;
    classDef success fill:#d9f2df,stroke:#34834b,color:#222;
    class D,P,R waiting;
    class H,O success;
```

## Workshop updates

Updates use the same download and ingestion path:

```mermaid
flowchart LR
    A["Tracked Workshop items"] --> B["Scheduled poll<br/>every 15 minutes"]
    B --> C["Check items due<br/>for refresh"]
    C --> D{"Update timestamp changed<br/>or daily download due?"}
    D -- No --> E["Record check<br/>Schedule next check"]
    D -- Yes --> F["Download and hash<br/>current package"]
    F --> G["Reuse known content<br/>or append a new revision"]
    G --> H["Process new maps<br/>Approve for registered Beta 7+ engines<br/>Retain previous versions"]
    E --> A
    H --> A
```

Successful items become due every **six hours**, with a forced download after
**one day**. Scheduling backlogs can delay checks. Existing games keep their
pinned map and engine versions; updates do not automatically reprocess them.

## Current prerequisites

As of November 13, 2026, authenticated downloads still await dedicated Steam
account setup and verification. Beta 8 engine activation remains a separate
requirement. Once a Beta 7+ engine is registered, scheduled maintenance also
approves eligible previously downloaded MCC maps for it. Older and other
engines require manual approval.

Automatic approval requires a downloaded Workshop revision with the exact
original SHA-256 and size, a processed MCC multiplayer map, an active release,
an immutable retained source and a current GLB. It preserves manual approvals
and retirements; ambiguity or missing evidence requires review. Replay
simulation and verification remain mandatory.
