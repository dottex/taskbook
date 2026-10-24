import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const fixture = {
  1: {
    _id: 1, _isTask: true, description: 'First task', priority: '1', boards: ['My Board'],
  },
  2: {
    _id: 2, _isTask: true, description: 'Second task', priority: '2', boards: ['@work'],
  },
  3: {
    _id: 3, _isTask: false, description: 'A note', boards: ['My Board'],
  },
  4: {
    _id: 4, _isTask: true, description: 'Unrelated task', priority: '3', boards: ['My Board'],
  },
};
const serializedFixture = JSON.stringify(fixture);
let failures = 0;
let cases = 0;

function runCase(name, input, {ids = [], level, expectedError} = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'taskbook-priority-'));

  try {
    const storageDirectory = path.join(home, '.taskbook', 'storage');
    fs.mkdirSync(storageDirectory, {recursive: true});
    const storageFile = path.join(storageDirectory, 'storage.json');
    fs.writeFileSync(storageFile, serializedFixture);
    const result = spawnSync(process.execPath, [cli, '--taskbook-dir', home, '-p', ...input], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: home,
        XDG_CACHE_HOME: home,
        TASKBOOK_DIR: '',
        CI: 'true',
        FORCE_COLOR: '0',
      },
      timeout: 10_000,
    });

    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    const content = fs.readFileSync(storageFile, 'utf8');
    const successes = output.split('Updated priority of task: ').slice(1).map(message => message.split(' ', 1)[0]);

    if (expectedError) {
      assert.equal(result.status, 1, output);
      assert.ok(output.includes(expectedError), output);
      assert.equal(content, serializedFixture);
      assert.deepEqual(successes, []);
    } else {
      assert.equal(result.status, 0, output);
      const expected = JSON.parse(serializedFixture);
      for (const id of ids) {
        expected[id].priority = level;
      }

      assert.deepEqual(JSON.parse(content), expected);
      assert.deepEqual(successes, ids);
      const label = {1: 'normal', 2: 'medium', 3: 'high'}[level];
      for (const id of ids) {
        assert.ok(output.includes(`Updated priority of task: ${id} to ${label}`), output);
      }
    }

    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}`);
    console.error(error);
  } finally {
    cases++;
    fs.rmSync(home, {recursive: true, force: true});
  }
}

runCase('single target before priority', ['@1', '2'], {ids: ['1'], level: '2'});
runCase('single target after priority', ['3', '@1'], {ids: ['1'], level: '3'});
runCase('single note remains supported', ['@3', '2'], {ids: ['3'], level: '2'});

for (const level of ['1', '2', '3']) {
  runCase(`batch priority ${level}`, [level, '@1', '@2'], {ids: ['1', '2'], level});
}

runCase('priority after targets', ['@1', '@2', '3'], {ids: ['1', '2'], level: '3'});
runCase('priority between targets', ['@1', '3', '@2'], {ids: ['1', '2'], level: '3'});
runCase('duplicate targets update once', ['@1', '2', '@1', '@2'], {ids: ['1', '2'], level: '2'});
runCase('batch containing a note', ['2', '@1', '@3'], {ids: ['1', '3'], level: '2'});
runCase('missing targets', ['2'], {expectedError: 'No id was given as input'});
runCase('missing priority', ['@1'], {expectedError: 'Priority can only be 1, 2 or 3'});
runCase('invalid priority', ['@1', '4'], {expectedError: 'Priority can only be 1, 2 or 3'});
runCase('unknown target', ['@99', '2'], {expectedError: 'Unable to find item with id: 99'});
runCase('invalid target after valid target leaves storage unchanged', ['2', '@1', '@99'], {
  expectedError: 'Unable to find item with id: 99',
});
runCase('nonnumeric target leaves storage unchanged', ['2', '@1', '@invalid'], {
  expectedError: 'Unable to find item with id: invalid',
});

console.log(`${cases - failures}/${cases} priority cases passed`);
process.exitCode = failures === 0 ? 0 : 1;
