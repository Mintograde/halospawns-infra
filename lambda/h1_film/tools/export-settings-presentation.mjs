// Compile the pinned game's own defaults/label functions; never transcribe preset values.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprintTree } from './source-fingerprint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: {
  source: { type: 'string' }, profile: { type: 'string' }, output: { type: 'string' },
  build: { type: 'string' }, image: { type: 'string', default: 'halospawns-beta7-linux-toolchain' }
} });
assert(args.source && args.profile && args.output && args.build,
  'Use --source <snapshot/src> --profile <id> --output <json> --build <scratch directory> [--image <Linux toolchain>]');
const registry = JSON.parse(await readFile(join(root, 'profiles/registry.json')));
const engine = registry.profiles.find(profile => profile.id === args.profile);
assert(engine, 'Unregistered engine profile');
const source = resolve(args.source), build = resolve(args.build);
const fingerprint = await fingerprintTree(source, ['CMakeLists.txt', 'engine', 'host', 'tools']);
assert.equal(fingerprint.sha256, engine.source.sha256, 'Source tree differs from the frozen engine');
await mkdir(build, { recursive: true });
const files = {};
async function host(name) {
  const path = `host/${name}`;
  const bytes = await readFile(join(source, path));
  files[path] = createHash('sha256').update(bytes).digest('hex');
  return bytes.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const header = await host('blampc_config.h'), menu = await host('blampc_menu.c');
const menuDefaults = await host('blampc_menu_defaults.h');
await host('blampc_config.c');
await host('blampc_gametype.c');
const fields = [...header.match(/struct blampc_gametype_custom\s*\{([\s\S]*?)\}/)[1]
  .matchAll(/\bint\s+(\w+)\s*;/g)].map(match => match[1]);
assert(fields.length >= 77, 'Modern variant layout expected');
const catalogue = JSON.parse(await readFile(join(root, 'contracts/h1film-settings-catalogue.v1.json')));
const aliases = { footstep_sounds: 'footstep_sounds_level', kill_restores: 'kill_restores_mode' };
const keyFor = field => `variant.${aliases[field] ?? field}`;
for (const field of fields) assert(catalogue.definitions[keyFor(field)], `Register exported field ${field} first`);
const sentence = text => (text.charAt(0).toUpperCase() + text.slice(1).toLowerCase())
  .replace(/\b(ctf|ffa|fov|mcc|nhe)\b/gi, word => word.toUpperCase());
const settings = {};
const put = (key, patch) => { settings[key] = { ...settings[key], ...patch }; };
for (const field of fields) {
  const key = keyFor(field), definition = catalogue.definitions[key];
  const unit = definition.type === 'boolean' ? 'boolean' : field.endsWith('_s') ? 'seconds'
    : field.endsWith('_min') ? 'minutes' : /_pct$|^os_brightness$|sounds$|ambience_volume|map_scenery_audio/.test(field) ? 'percent' : 'number';
  put(key, { label: sentence(field.replace(/_(s|min)$/, '').replaceAll('_', ' ')), format: unit });
}
for (const [, row, field] of menu.matchAll(/GT_1\((ROW_\w+),\s*(\w+)\)/g)) {
  const match = menu.match(new RegExp(`row_addf?\\(${row},\\s*1,\\s*"([^"]+)"`));
  if (match && fields.includes(field)) put(keyFor(field), { label: sentence(match[1]) });
}
// Earlier menus predate GT_1's field map. The displayed expression still names its field.
for (const [, label, expression] of menu.matchAll(/row_addf?\(ROW_GT_\w+,\s*1,\s*"([^"]+)",([^;]+);/g)) {
  const names = [...new Set([...expression.matchAll(/g->(\w+)/g)].map(match => match[1]))];
  if (names.length === 1 && fields.includes(names[0])) put(keyFor(names[0]), { label: sentence(label) });
}
const choices = (key, labels) => put(key, { choices: Array.isArray(labels) ? Object.fromEntries(labels.map((label, i) => [i, label])) : labels });
for (const key of ['flag_pickup', 'ball_pickup']) choices(`variant.${key}`, ['Manual', 'Automatic']);
choices('variant.hill_order', ['Ordered', 'Random after first']);
choices('variant.infinite_ammo', ['Off', 'Bottomless clip', 'Unlimited magazines']);
const weapons = ['Pistol', 'Sniper rifle', 'Rocket launcher', 'Plasma pistol', 'Assault rifle', 'Needler', 'Plasma rifle', 'Shotgun'];
for (const [key, weapon] of [['weapon_primary', 'Assault rifle'], ['weapon_secondary', 'Pistol']]) {
  choices(`variant.${key}`, { ...Object.fromEntries(weapons.map((label, i) => [i, label])), '-1': `Default (${weapon})`,
    ...(key === 'weapon_secondary' && menuDefaults.includes('BLAMPC_GT_WEAPON_NONE') ? { '-2': 'None' } : {}) });
  put(`variant.${key}`, { equivalent_values: { '-1': key === 'weapon_primary' ? 4 : 0 } });
}
choices('variant.camo_variant', ['Xbox', 'MCC Hardcore', 'Custom']);
choices('variant.spawns_visible', ['Off', 'Markers', 'Markers + zones']);
choices('variant.powerup_waypoints', ['Off', 'On']);
choices('variant.random_pct_visible', ['Off', 'On']);
choices('variant.os_type', ['Constant', 'Fading']);
choices('variant.omit_first_spawn', ['No', 'Yes', 'Power items only']);
choices('variant.fov_limit', ['On', 'Split screen only', 'Off']);
choices('variant.smoke_rendering', ['Force original', 'Force performance', 'Not forced']);
choices('variant.map_scripts_off', ['Yes', 'No']);
choices('variant.weapon_sounds_all', ['Pro', 'All']);
choices('variant.overtime', ['No', 'Yes']);
choices('variant.overtime_timed', ['Yes', 'No']); // The game labels this inverse field SUDDEN DEATH.
for (const [field, table] of [['kill_restores_mode', 'k_kill_restores'], ['alternating_powerups', 'k_gt_alt_powerups']]) {
  const body = menu.match(new RegExp(`${table}\\[[^\\]]*\\]\\s*=\\s*\\{([^}]+)\\}`));
  assert(body, `Missing enum table ${table}`);
  choices(`variant.${field}`, [...body[1].matchAll(/"([^"]+)"/g)].map(match => sentence(match[1])));
  const row = menu.match(new RegExp(`row_add\\(ROW_\\w+,\\s*1,\\s*"([^"]+)",\\s*${table}\\[`));
  if (row) put(`variant.${field}`, { label: sentence(row[1]) });
}
for (const [key, label] of [['time_limit_min', 'None'], ['health_pct', 'Infinite'], ['ctf_single_flag_s', 'Off'], ['item_spawn_s', 'Off'], ['score_to_win', 'Unlimited']])
  put(`variant.${key}`, { special_values: { 0: label } });
put('variant.ctf_flag_reset_s', { special_values: { 0: 'Default (17 s)' }, equivalent_values: { 0: 17 } });
put('variant.ball_reset_s', { special_values: { 0: 'Default (40 s)' }, equivalent_values: { 0: 40 } });
put('variant.hill_move_s', { special_values: { 0: 'Default (60 s)' }, equivalent_values: { 0: 60 } });
const overtimeDefault = Number(header.match(/^#define BLAMPC_GT_OVERTIME_DEFAULT_MIN\s+(\d+)/m)?.[1]);
assert(Number.isSafeInteger(overtimeDefault));
put('variant.overtime_length_min', { special_values: { 0: `Default (${overtimeDefault} min)` }, equivalent_values: { 0: overtimeDefault } });

// Mode/enable dependencies are declarative so a new engine need not change frontend code.
for (const field of fields) {
  const key = keyFor(field), conditions = [];
  const mode = field.startsWith('ctf_') || field === 'flag_pickup' ? 1
    : field.startsWith('ball_') ? 3 : /^(hill_|king_)/.test(field) ? 4 : null;
  if (mode !== null) conditions.push({ key: 'variant.game_rules', values: [mode] });
  if (field === 'objectives_indicator') conditions.push({ key: 'variant.game_rules', values: [1, 3, 4] });
  if (['fireteams', 'friend_indicators', 'teammate_outlines', 'teammate_view', 'teammate_respawn_timers', 'random_pct_visible'].includes(field))
    conditions.push({ key: 'variant.teams', values: [true] });
  if (/^os_(tint_|brightness|type)/.test(field)) conditions.push({ key: 'variant.overshield_visible', values: [true] });
  if (/^camo_(refraction|falloff|tint_)/.test(field)) conditions.push({ key: 'variant.camo_variant', values: [2] });
  if (['hill_order', 'hill_move_s'].includes(field)) conditions.push({ key: 'variant.king_moving_hill', values: [true] });
  if (field.startsWith('overtime')) conditions.push({ key: 'variant.time_limit_min', greater_than: 0 });
  if (['overtime_timed', 'overtime_length_min'].includes(field)) conditions.push({ key: 'variant.overtime', values: [1] });
  if (field === 'overtime_length_min') conditions.push({ key: 'variant.overtime_timed', values: [1] });
  if (conditions.length) put(key, { active_when: conditions });
}

const defaults = {};
for (const name of ['blampc_movement.c', 'blampc_wall_jump.c', 'blampc_crouch_slide.c']) {
  const code = await host(name);
  for (const [, label, field, value, rest] of code.matchAll(/\{\s*"([^"]+)",\s*"(\w+)",\s*(-?\d+),([^}]+)\}/g)) {
    const key = `tuning.${field}`, definition = catalogue.definitions[key];
    if (!definition) continue; // New raw fields require a settings adapter change, not invented evidence.
    defaults[key] = definition.type === 'boolean' ? Number(value) !== 0 : Number(value);
    let format = definition.type === 'boolean' ? 'boolean' : /_MS/.test(rest) ? 'milliseconds' : /_PCT/.test(rest) ? 'percent'
      : /_X100/.test(rest) ? 'hundredths' : 'thousandths';
    put(key, { label: sentence(label), format });
    if (/^wall_jump_/.test(field)) put(key, { active_when: [{ key: 'tuning.wall_jump', values: [true] }] });
    if (/^crouch_slide_/.test(field)) put(key, { active_when: [{ key: 'tuning.crouch_slide', values: [true] }] });
  }
}
choices('tuning.plasma_grenade_stickiness', ['Players only', 'Players + environment', 'Players + environment + held weapons']);
choices('tuning.pistol_spread', ['NHE', 'Stock', 'MCC Hardcore']);
choices('tuning.shotgun_spread_constant', { true: 'Constant', false: 'Random' });
put('tuning.plasma_climb_gain', { format: 'percent', active_when: [{ key: 'tuning.plasma_climb', values: [true] }] });
choices('network.net_model', ['Lockstep', 'Rollback', 'Prediction', 'Universal']);
choices('network.shot_prediction', ['Off', 'On']);
const botHeader = await host('blampc_bots.h');
choices('bots.bot_skill', ['Easy', 'Normal', 'Heroic', 'Legendary',
  ...(/BLAMPC_BOTS_SKILL_MYTHIC\s+4/.test(botHeader) ? ['Mythic'] : [])]);
choices('bots.bot_teams', { auto: 'Automatic' });
for (const key of ['bots.bot_skill', 'bots.bot_teams']) put(key, { active_when: [{ key: 'bots.bots', greater_than: 0 }] });
choices('recording.end_reason', ['Unknown / no trailer', 'Session ended', 'Tick limit reached']);
for (const key of ['recording.format', 'recording.protocol_revision']) put(key, { format: 'number' });
const pipeline = (await host('blampc_input_pipeline.c')).match(/^#define PIPELINE_PRESET_MS (\d+)/m);
assert(pipeline);
Object.assign(defaults, { 'timing.input_pipeline_ms': Number(pipeline[1]), 'timing.shot_delay_aim_ms': 0,
  'timing.aim_rate_hz': 120, 'timing.shot_aim_ahead_ticks': 0, 'bots.bots': 0, 'bots.bot_teams': 'auto' });
// Network model is deliberately not compared: LAN and online have different defaults.
await host('blampc_bots.h');
const c = [`#include <stdio.h>\n#include "blampc_config.h"\n#include "blampc_bots.h"\nint main(void) {`];
for (const [field, macro] of Object.entries({ plasma_overheat_damage: 'PLASMA_OVERHEAT_DAMAGE', plasma_grenade_stickiness: 'PG_STICKINESS',
  pistol_spread: 'PISTOL_SPREAD', shotgun_spread_constant: 'SHOTGUN_SPREAD_CONSTANT', plasma_climb: 'PLASMA_CLIMB', plasma_climb_gain: 'PLASMA_CLIMB_GAIN' }))
  c.push(`printf("D\\ttuning.${field}\\t%d\\n", BLAMPC_DEFAULT_${macro});`);
c.push('printf("D\\tbots.bot_skill\\t%d\\n", BLAMPC_BOTS_SKILL_DEFAULT);');
c.push('for(int i=0;i<blampc_gametype_builtin_count();i++){ const struct blampc_gametype_custom *g=blampc_gametype_builtin_at(i);');
for (const field of fields) c.push(`printf("V\\t%s\\t${keyFor(field)}\\t%d\\n",g->name,g->${field});`);
c.push('}');
const helpers = { ball_type: ['BLAMPC_BALL_TYPE_N', 'ball_type'], objectives_indicator: ['BLAMPC_OBJ_IND_N', 'obj_indicator'],
  camo_drop: ['BLAMPC_CAMO_DROP_N', 'camo_drop'], os_assassination: ['BLAMPC_OS_ASSASSIN_N', 'os_assassination'],
  ball_speed: ['BLAMPC_BALL_SPEED_N', 'ball_speed'], ball_trait_with: ['BLAMPC_TRAIT_N', 'trait'], ball_trait_without: ['BLAMPC_TRAIT_N', 'trait'] };
if (fields.includes('weapon_set')) helpers.weapon_set = ['BLAMPC_GT_WEAPON_SET_N', 'weapon_set'];
for (const [field, [count, fn]] of Object.entries(helpers))
  c.push(`for(int i=0;i<${count};i++) printf("E\\tvariant.${field}\\t%d\\t%s\\n",i,blampc_gametype_${fn}_label(i));`);
c.push('for(int i=0;i<blampc_gametype_rules_count();i++){ int r=blampc_gametype_rules_at(i); printf("E\\tvariant.game_rules\\t%d\\t%s\\n",r,blampc_gametype_rules_label(r)); }', 'return 0; }');
await writeFile(join(build, 'extract.c'), c.join('\n'));
const shell = `clang-18 -std=c17 -m32 -w -fms-extensions -fshort-wchar -malign-double -mms-bitfields -ffunction-sections -fdata-sections -DBLAMPC_PASS_TLS=0 -I/src/linux_server/include -I/src/host/compat -I/src/host -I/src/engine -I/src/engine/headers -include linux_server_prelude.h -include blampc_prelude.h /out/extract.c /src/host/blampc_config.c /src/host/blampc_gametype.c /src/linux_server/platform/linux_printf.c -Wl,--gc-sections -lm -o /out/extract > /out/compile.log 2>&1 && /out/extract`;
const output = execFileSync('docker', ['run', '--rm', '--mount', `type=bind,source=${source},target=/src,readonly`, '--mount',
  `type=bind,source=${build},target=/out`, args.image, 'sh', '-c', shell], { encoding: 'utf8' });
await writeFile(join(build, 'extracted.tsv'), output);
const presets = {};
for (const line of output.trim().split(/\r?\n/)) {
  const [kind, a, b, d] = line.split('\t');
  const typed = (key, value) => catalogue.definitions[key].type === 'boolean' ? Number(value) !== 0 : Number(value);
  if (kind === 'V') { presets[a] ??= {}; presets[a][b] = typed(b, d); }
  else if (kind === 'D') defaults[a] = typed(a, b);
  else if (kind === 'E') { settings[a] ??= {}; settings[a].choices ??= {}; settings[a].choices[b] = sentence(d); }
  else assert.fail(`Unknown extractor record ${kind}`);
}
assert.equal(Object.keys(presets).length, 7);
for (const field of fields) {
  const key = keyFor(field), rule = settings[key];
  assert(catalogue.definitions[key].unit !== 'code' || rule.choices || rule.format !== 'number'
    || /^(camo_(refraction|falloff|tint_[rgb])|os_tint_(perp|par)_[rgb])$/.test(field),
  `Review the display semantics for new coded field ${key}`);
}
const data = { schema: 'halospawns.h1SettingsPresentation.v1', engine_profile: engine.id,
  source_commit: engine.source.git_commit, source_sha256: engine.source.sha256, source_files: files,
  label: engine.port.replace(/^beta/, 'Beta '), settings, defaults,
  pipeline_ms: Number(pipeline[1]), presets: Object.entries(presets).map(([label, values]) => ({ label: sentence(label), values })) };
await writeFile(resolve(args.output), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ profile: engine.id, fields: fields.length, presets: data.presets.length, settings: Object.keys(settings).length }));
