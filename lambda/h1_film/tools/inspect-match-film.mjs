import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {inspectMatchFilm} from '../runtime/match-film.mjs';
export {inspectMatchFilm};
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,3,'Usage: node inspect-match-film.mjs FILM.h1film');
  console.log(JSON.stringify(inspectMatchFilm(await readFile(process.argv[2])),null,2));
}
