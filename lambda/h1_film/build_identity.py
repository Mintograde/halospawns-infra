"""Recorder labels are evidence, separate from immutable simulation identities."""

import re

BUILD_MATCHING_CONTRACT = "halospawns.h1RecordedBuild.v1"
SOURCE_COMMIT_RULE = "source_commit_suffix_v1"
SIMULATION_IDENTITY = ("format", "protocol_revision", "tick_rate")


def matches_profile(profile, film, rule=None):
    if any(type(film.get(key)) is not type(profile[key]) or film[key] != profile[key]
           for key in SIMULATION_IDENTITY):
        return False
    build = film.get("build")
    if build == profile["build"]:
        return True
    if rule != SOURCE_COMMIT_RULE or not isinstance(build, str):
        return False
    if not re.fullmatch(r"[\x20-\x7e]{1,63}", build):
        return False
    # PB2 appends its clean Git abbreviation (at least eight hex digits).
    # A trailing '+' denotes modified sources and deliberately does not match.
    commit = re.search(r"(?:^| - )([0-9a-f]{8,40})$", build)
    source = profile.get("source", {}).get("git_commit", "")
    return bool(commit and source.startswith(commit[1]))


def validate_build_matching(profiles, rules):
    if not isinstance(rules, dict):
        raise ValueError("Invalid recorded build matching rules")
    profiles = {profile["id"]: profile for profile in profiles}
    for name, rule in rules.items():
        source = profiles.get(name, {}).get("source", {})
        if (name not in profiles or rule != SOURCE_COMMIT_RULE or not isinstance(source, dict)
                or source.get("project") != "h1arena"
                or not isinstance(source.get("git_commit"), str)
                or not re.fullmatch(r"[0-9a-f]{40}", source.get("git_commit", ""))):
            raise ValueError("Invalid recorded build matching rule or source")
    entries = list(profiles.items())
    for index, (name, profile) in enumerate(entries):
        for other_name, other in entries[index + 1:]:
            if any(profile[key] != other[key] for key in SIMULATION_IDENTITY):
                continue
            if (matches_profile(profile, other, rules.get(name))
                    or matches_profile(other, profile, rules.get(other_name))
                    or (name in rules and other_name in rules
                        and profile["source"]["git_commit"][:8]
                        == other["source"]["git_commit"][:8])):
                raise ValueError("Ambiguous recorded build matching rules")
    return rules
