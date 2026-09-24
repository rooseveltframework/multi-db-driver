process.env.MULTI_DB_DRIVER_CONFIG_FILE_SEARCH_ATTEMPTS = 1 // set config search attempts to 1 by default
const { describe, it, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const multiDb = require('../multi-db-driver')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const cleanUp = require(path.join(__dirname, './util/cleanUp.js'))
const createConfigs = path.join(__dirname, './util/createConfigs.js')
const createDatabase = require(path.join(__dirname, './util/createDatabase.js'))
const destroyDatabase = require(path.join(__dirname, './util/destroyDatabase.js'))
const destroyedDatabaseCheck = require(path.join(__dirname, './util/destroyedDatabaseCheck.js'))
const dumpData = require(path.join(__dirname, './util/dumpData.js'))
const dumpSchema = require(path.join(__dirname, './util/dumpSchema.js'))
const executeSqlFile = require(path.join(__dirname, './util/executeSqlFile.js'))
const fixture = require(path.join(__dirname, './util/fixture.js'))
const reportPrerequisites = require(path.join(__dirname, './util/reportPrerequisites.js'))
const runQueryWithInvalidSyntax = require(path.join(__dirname, './util/runQueryWithInvalidSyntax.js'))

// only register a suite or test when this run has a server for the engine it needs, so that a missing database is reported as a skip rather than quietly passing because the connection failed for the wrong reason
const describeIf = engine => fixture.available(engine) ? describe : describe.skip
const itIf = engine => fixture.available(engine) ? it : it.skip

// the dump commands shell out, so their tests need the binary installed as well as the engine reachable. without this they would pass for the wrong reason: a missing binary errors just like a failed dump does
const itIfDump = engine => fixture.canDump(engine) ? it : it.skip

// child processes inherit whatever colour settings the developer has set, and these tests compare their stdout literally. a value such as undefined goes through util.inspect and comes back wrapped in ansi escapes when colour is on, so colour is disabled for everything spawned from here
const plainOutput = { shell: false, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } }

// values to be used in tests
const values = [
  { name: 'magnus', description: 'chess master' },
  { name: 'nick', description: 'software engineer' },
  { name: 'tua', description: 'quarterback' }
]

before(async function () {
  await fixture.start()
  await reportPrerequisites() // say plainly what this machine cannot test, and how to fix it
  require(createConfigs)()
})

after(async function () {
  // the generated config is missing if the before hook failed, in which case there is nothing to tear down but the servers themselves
  if (fs.existsSync(path.normalize('.multi-db-driver-config.json'))) {
    for (const engine of ['mysql', 'pglite', 'postgres', 'sqlite']) {
      if (fixture.available(engine)) await destroyDatabase(engine)
    }
  }
  await fixture.stop()
  cleanUp()
})

// clean up files on ctrl + c
process.on('SIGINT', () => {
  cleanUp()
  process.exit()
})

// CLI tests
describe('CLI', function () {
  itIf('mariadb')('should run --create CLI script and create MariaDB user, database and table', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.mariadb-config.json' // env var for config location
    const result = await createDatabase('mariadb', false, true) // create database
    await destroyDatabase('mariadb') // destroy database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'created') // check if result equals 'created'
  })

  itIf('mariadb')('should run --destroy CLI script and destroy MariaDB database', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.mariadb-config.json' // env var for config location
    await createDatabase('mariadb') // create database
    const droppedDatabase = await destroyDatabase('mariadb') // destroy database
    const result = await destroyedDatabaseCheck('mariadb', droppedDatabase) // destroy database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'destroyed') // check if result equals 'destroyed'
  })

  itIf('mariadb')('should run --file CLI script against a MariaDB database', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.mariadb-config.json' // env var for config location
    await createDatabase('mariadb') // create database
    const result = await executeSqlFile('mariadb', './test/db/mariadb_and_mysql_file.sql', false, true) // execute SQL file; also test verbose logging
    await destroyDatabase('mariadb') // destroy database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'executed') // check if result equals 'executed'
  })

  itIfDump('mariadb')('should run --dump-schema CLI script and dump schema of connected MariaDB database to defined path', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.mariadb-config.json' // env var for config location
    await createDatabase('mariadb') // create database
    const result = await dumpSchema('mariadb', './test/db/schema.sql') // dump schema
    await destroyDatabase('mariadb') // destroy database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'executed')
  })

  itIfDump('mariadb')('should run --dump-data CLI script and dump data connected MariaDB database to defined path', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.mariadb-config.json' // env var for config location
    await createDatabase('mariadb') // create database
    const result = await dumpData('mariadb', './test/db/schema.sql') // dump data
    await destroyDatabase('mariadb') // destroy database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'executed')
  })

  itIfDump('mariadb')('should run MariaDB --dump-schema CLI script and print error due to mysqldump command not being in PATH', async function () {
    const pathEnv = process.env.PATH

    // remove mysql from PATH
    const command = os.platform() === 'win32' ? 'where' : 'which'
    const args = os.platform() === 'win32' ? ['mysql'] : ['-a', 'mysql']
    const mysqlPath = spawnSync(command, args, { shell: false })
    const mysqlPathArr = mysqlPath.stdout.toString().trim().split('\n')
    const splitPath = os.platform() === 'win32' ? process.env.PATH.split(';') : process.env.PATH.split(':')
    for (let i = 0; i < mysqlPathArr.length; i++) {
      const splitMysqlPath = os.platform() === 'win32' ? mysqlPathArr[i].split('\\') : mysqlPathArr[i].split('/')
      splitMysqlPath.splice(splitMysqlPath.length - 1, 1)
      const joinMysqlPath = os.platform() === 'win32' ? splitMysqlPath.join('\\') : splitMysqlPath.join('/')
      for (let j = 0; j < splitPath.length; j++) {
        if (splitPath[j] === joinMysqlPath) splitPath.splice(j, 1)
      }
    }
    const joinPathNoMysql = os.platform() === 'win32' ? splitPath.join(';') : splitPath.join(':')
    process.env.PATH = joinPathNoMysql

    // run dump schema script
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.mariadb-config.json' // env var for config location
    const result = await dumpSchema('mariadb', './test/db/schema.sql')

    process.env.PATH = pathEnv // reset PATH for rest of tests
    await destroyDatabase('mariadb') // destroy database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'error') // check if result equals 'error'
  })

  itIf('mysql')('should run --create CLI script and create MySQL user, database, and table', async function () {
    const result = await createDatabase('mysql', false, true) // create database; also test verbose logs
    assert.equal(result, 'created') // check if result equals 'created'
  })

  itIf('mysql')('should run --destroy CLI script and destroy MySQL database', async function () {
    await createDatabase('mysql') // create database
    const droppedDatabase = await destroyDatabase('mysql') // destroy database
    const result = await destroyedDatabaseCheck('mysql', droppedDatabase) // destroy database
    assert.equal(result, 'destroyed') // check if result equals 'destroyed'
  })

  itIf('mysql')('should run --file CLI script against a MySQL database', async function () {
    await createDatabase('mysql') // create database
    const result = await executeSqlFile('mysql', './test/db/mariadb_and_mysql_file.sql', false, true) // execute SQL file; also test verbose logging
    assert.equal(result, 'executed') // check if result equals 'executed'
  })

  itIfDump('mysql')('should run --dump-schema CLI script and dump schema of connected MySQL database to defined path', async function () {
    await createDatabase('mysql') // create database
    const result = await dumpSchema('mysql', './test/db/schema.sql')
    assert.equal(result, 'executed')
  })

  itIfDump('mysql')('should run --dump-data CLI script and dump data connected MySQL database to defined path', async function () {
    await createDatabase('mysql') // create database
    const result = await dumpData('mysql', './test/db/schema.sql')
    assert.equal(result, 'executed')
  })

  itIfDump('mysql')('should run MySQL --dump-schema CLI script and print error due to invalid path', async function () {
    await createDatabase('mysql') // create database
    const result = await dumpSchema('mysql', './test/invalid/schema.sql')
    assert.equal(result, 'error')
  })

  itIfDump('mysql')('should run MySQL --dump-data CLI script and print error due to invalid path', async function () {
    await createDatabase('mysql') // create database
    const result = await dumpData('mysql', './test/invalid/schema.sql')
    assert.equal(result, 'error')
  })

  itIfDump('mysql')('should run MySQL --dump-schema CLI script and print error due to mysqldump command not being in PATH', async function () {
    const pathEnv = process.env.PATH

    // remove mysql from PATH
    const command = os.platform() === 'win32' ? 'where' : 'which'
    const args = os.platform() === 'win32' ? ['mysql'] : ['-a', 'mysql']
    const mysqlPath = spawnSync(command, args, { shell: false })
    const mysqlPathArr = mysqlPath.stdout.toString().trim().split('\n')
    const splitPath = os.platform() === 'win32' ? process.env.PATH.split(';') : process.env.PATH.split(':')
    for (let i = 0; i < mysqlPathArr.length; i++) {
      const splitMysqlPath = os.platform() === 'win32' ? mysqlPathArr[i].split('\\') : mysqlPathArr[i].split('/')
      splitMysqlPath.splice(splitMysqlPath.length - 1, 1)
      const joinMysqlPath = os.platform() === 'win32' ? splitMysqlPath.join('\\') : splitMysqlPath.join('/')
      for (let j = 0; j < splitPath.length; j++) {
        if (splitPath[j] === joinMysqlPath) splitPath.splice(j, 1)
      }
    }
    const joinPathNoMysql = os.platform() === 'win32' ? splitPath.join(';') : splitPath.join(':')
    process.env.PATH = joinPathNoMysql

    // run dump schema script
    const result = await dumpSchema('mysql', './test/db/schema.sql')

    process.env.PATH = pathEnv // reset PATH for rest of tests
    assert.equal(result, 'error') // check if result equals 'error'
  })

  it('should run --create CLI script and create PGlite database', async function () {
    const result = await createDatabase('pglite', true) // create database
    await destroyDatabase('pglite')
    assert.equal(result, 'created') // check if result equals 'created'
  })

  it('should run --destroy CLI script and destroy PGlite database', async function () {
    await createDatabase('pglite') // create database
    const droppedDatabase = await destroyDatabase('pglite') // destroy database
    const result = await destroyedDatabaseCheck('pglite', droppedDatabase) // check if database was destroyed
    assert.equal(result, 'destroyed') // check if result equals 'destroyed'
  })

  it('should run --file CLI script against a PGlite database', async function () {
    await createDatabase('pglite') // create database
    const result = await executeSqlFile('pglite', './test/db/pglite_postgres_and_sqlite_file.sql', true) // execute SQL file
    await destroyDatabase('pglite')
    assert.equal(result, 'executed') // check if result equals 'executed'
  })

  itIf('postgres')('should run --create CLI script and create PostgreSQL user, database, and table', async function () {
    const result = await createDatabase('postgres', true) // create database
    assert.equal(result, 'created') // check if result equals 'created'
  })

  itIf('postgres')('should run --destroy CLI script and destroy PostgreSQL database', async function () {
    await createDatabase('postgres') // create database
    const droppedDatabase = await destroyDatabase('postgres') // destroy database
    const result = await destroyedDatabaseCheck('postgres', droppedDatabase)
    assert.equal(result, 'destroyed') // check if result equals 'destroyed'
  })

  itIf('postgres')('should run --file CLI script against a PostgreSQL database', async function () {
    await createDatabase('postgres') // create database
    const result = await executeSqlFile('postgres', './test/db/pglite_postgres_and_sqlite_file.sql') // execute SQL file
    assert.equal(result, 'executed') // check if result equals 'executed'
  })

  itIfDump('postgres')('should run --dump-schema CLI script and dump schema of connected PostgreSQL database to defined path', async function () {
    await createDatabase('postgres') // create database
    const result = await dumpSchema('postgres', './test/db/schema.sql')
    assert.equal(result, 'executed')
  })

  itIfDump('postgres')('should run --dump-data CLI script and dump data of connected PostgreSQL database to defined path', async function () {
    await createDatabase('postgres') // create database
    const result = await dumpData('postgres', './test/db/schema.sql')
    assert.equal(result, 'executed')
  })

  itIfDump('postgres')('should run PostgreSQL --dump-schema CLI script and print error due to invalid path', async function () {
    await createDatabase('postgres') // create database
    const result = await dumpSchema('postgres', './test/invalid/schema.sql')
    assert.equal(result, 'error')
  })

  itIfDump('postgres')('should run PostgreSQL --dump-data CLI script and print error due to invalid path', async function () {
    await createDatabase('postgres') // create database
    const result = await dumpData('postgres', './test/invalid/schema.sql')
    assert.equal(result, 'error')
  })

  itIfDump('postgres')('should run PostgreSQL --dump-schema CLI script and print error due to pg_dump command not being in PATH', async function () {
    const pathEnv = process.env.PATH

    // remove psql from PATH
    const command = os.platform() === 'win32' ? 'where' : 'which'
    const args = os.platform() === 'win32' ? ['psql'] : ['-a', 'psql']
    const psqlPath = spawnSync(command, args, { shell: false })
    const psqlPathArr = psqlPath.stdout.toString().trim().split('\n')
    const splitPath = os.platform() === 'win32' ? process.env.PATH.split(';') : process.env.PATH.split(':')
    for (let i = 0; i < psqlPathArr.length; i++) {
      const splitPsqlPath = os.platform() === 'win32' ? psqlPathArr[i].split('\\') : psqlPathArr[i].split('/')
      splitPsqlPath.splice(splitPsqlPath.length - 1, 1)
      const joinPsqlPath = os.platform() === 'win32' ? splitPsqlPath.join('\\') : splitPsqlPath.join('/')
      for (let j = 0; j < splitPath.length; j++) {
        if (splitPath[j] === joinPsqlPath) splitPath.splice(j, 1)
      }
    }
    const joinPathNoPsql = os.platform() === 'win32' ? splitPath.join(';') : splitPath.join(':')
    process.env.PATH = joinPathNoPsql

    const result = await dumpSchema('postgres', './test/db/schema.sql')

    process.env.PATH = pathEnv // reset PATH for rest of tests
    assert.equal(result, 'error')
  })

  it('should run --create CLI script and create SQLite database, and table', async function () {
    const result = await createDatabase('sqlite') // create database
    assert.equal(result, 'created') // check if result equals 'created'
  })

  it('should run --destroy CLI script and destroy SQLite database', async function () {
    await createDatabase('sqlite') // create database
    const droppedDatabase = await destroyDatabase('sqlite') // destroy database
    const result = await destroyedDatabaseCheck('sqlite', droppedDatabase) // destroy database check
    assert.equal(result, 'destroyed') // check if result equals 'destroyed'
  })

  it('should run --file CLI script against a SQLite database', async function () {
    await createDatabase('sqlite') // create database
    const result = await executeSqlFile('sqlite', './test/db/pglite_postgres_and_sqlite_file.sql', null, null, true) // execute SQL file
    assert.equal(result, 'executed') // check if result equals 'executed'
  })

  itIfDump('sqlite')('should run --dump-schema CLI script and dump schema of connected SQLite database to defined path', async function () {
    await createDatabase('sqlite') // create database
    const result = await dumpSchema('sqlite', './test/db/schema.sql')
    assert.equal(result, 'executed')
  })

  itIfDump('sqlite')('should run --dump-data CLI script and dump data connected SQLite database to defined path', async function () {
    await createDatabase('sqlite') // create database
    const result = await dumpData('sqlite', './test/db/schema.sql')
    assert.equal(result, 'executed')
  })

  itIfDump('sqlite')('should run SQLite --dump-schema CLI script and print error due to pg_dump command not being in PATH', async function () {
    const pathEnv = process.env.PATH

    // remove sqlite3 from PATH
    const command = os.platform() === 'win32' ? 'where' : 'which'
    const args = os.platform() === 'win32' ? ['sqlite3'] : ['-a', 'sqlite3']
    const sqlitePath = spawnSync(command, args, { shell: false })
    const sqlitePathArr = sqlitePath.stdout.toString().trim().split('\n')
    const splitPath = os.platform() === 'win32' ? process.env.PATH.split(';') : process.env.PATH.split(':')
    for (let i = 0; i < sqlitePathArr.length; i++) {
      const splitSqlitePath = os.platform() === 'win32' ? sqlitePathArr[i].split('\\') : sqlitePathArr[i].split('/')
      splitSqlitePath.splice(splitSqlitePath.length - 1, 1)
      const joinSqlitePath = os.platform() === 'win32' ? splitSqlitePath.join('\\') : splitSqlitePath.join('/')
      for (let j = 0; j < splitPath.length; j++) {
        if (splitPath[j] === joinSqlitePath) splitPath.splice(j, 1)
      }
    }
    const joinPathNoSqlite = os.platform() === 'win32' ? splitPath.join(';') : splitPath.join(':')
    process.env.PATH = joinPathNoSqlite

    const result = await dumpSchema('sqlite', './test/db/schema.sql')
    process.env.PATH = pathEnv // reset PATH for rest of tests
    assert.equal(result, 'error')
  })

  itIf('postgres')('should run --create CLI script and print error due to undefined schema', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.multi-db-driver-config-no-schema.json' // env var for config location
    const result = await createDatabase('sqlite') // create database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'error') // check if result equals 'executed'
  })

  itIf('postgres')('should run --create CLI script and print error due to invalid schema syntax', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.multi-db-driver-config-invalid-schema.json' // env var for config location
    const result = await createDatabase('sqlite') // create database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'error') // check if result equals 'executed'
  })

  it('should run --create CLI script and print error due to invalid schema file path', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.multi-db-driver-config-invalid-schema-path.json' // env var for config location
    const result = await createDatabase('sqlite') // create database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'error') // check if result equals 'executed'
  })

  it('should run --file CLI script and print error due to invalid file', async function () {
    await createDatabase('sqlite') // create database
    const result = await executeSqlFile('sqlite', './test/db/error_file.sql') // execute invalid SQL file
    assert.equal(result, 'error') // check if result equals 'executed'
  })
})

describe('multi-db-driver', function () {
  it('should print error due to invalid config file', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/invalid-config.txt' // env var for config location
    const result = await createDatabase('sqlite') // create database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'error') // check if invalid config was used and returns error
  })

  it('should print error due to invalid config path', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = '.files/.alternate-config.json' // env var for config location
    const result = await createDatabase('sqlite') // create database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'error') // check if invalid config path was used and returns error
  })

  it('should print error due to config with no default value', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.invalid-config.json' // env var for config location
    const result = await createDatabase('sqlite') // create database
    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    assert.equal(result, 'error') // check if invalid config was used and returns error
  })

  it('should use env var for alternate config name and location', async function () {
    process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = './test/configs/.alternate-config.json' // env var for config location
    const altConfig = require('./configs/.alternate-config.json') // alternate config variable
    await createDatabase('sqlite') // create database

    // connect to database with loggerConfig
    const db = await require('../multi-db-driver')({
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    await db.endConnection() // end connection
    assert.equal(JSON.stringify(db.config[db.config.default]).trim(), JSON.stringify(altConfig[altConfig.default]).trim()) // check if alternate config was used in db connection
  })

  it('should go up 2 directories to find config', async function () {
    await createDatabase('sqlite') // create database
    process.env.MULTI_DB_DRIVER_CONFIG_FILE_SEARCH_ATTEMPTS = null // set config search attempts to null

    // create nested folders
    if (!fs.existsSync(path.normalize(path.join(__dirname, '/nested-multi-db')))) {
      fs.mkdirSync(path.normalize(path.join(__dirname, '/nested-multi-db')))
      fs.mkdirSync(path.normalize(path.join(__dirname, '/nested-multi-db', '/nested-multi-db-2')))
      fs.mkdirSync(path.normalize(path.join(__dirname, '/nested-multi-db', '/nested-multi-db-2', '/nested-multi-db-3')))
    }

    // create multi-db-driver-config.json
    async function createConfig () {
      const configString = JSON.stringify({
        default: 'sqlite',
        sqlite: {
          config: {
            database: './test/sqlite-db/3_dirs_up_sqlite_multi_db_tests_database.sqlite'
          },
          schema: './test/db/pglite_postgres_and_sqlite_schema.sql'
        }
      }, null, 2)
      const filePath = path.resolve(__dirname, 'nested-multi-db', '.multi-db-driver-config.json') // Use path.resolve to go up 1 directories from the current directory
      fs.writeFileSync(path.normalize(filePath), configString)
    }

    await createConfig()
    const nestedConfig = require('./nested-multi-db/.multi-db-driver-config.json') // .multi-db-driver-config.json in nested-multi-db dir
    process.chdir('./test/nested-multi-db/nested-multi-db-2/nested-multi-db-3') // change dir to nested-multi-db-3

    // connect to database with loggerConfig
    const db = await multiDb({
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    process.chdir('../../../../') // change dir back to multi-db
    await db.endConnection() // end connection
    process.env.MULTI_DB_DRIVER_CONFIG_FILE_SEARCH_ATTEMPTS = 1 // reset search attempts env var
    assert.equal(JSON.stringify(db.config[db.config.default]).trim(), JSON.stringify(nestedConfig[nestedConfig.default]).trim()) // check if nested config was used in db connection
  })

  it('should print error due to falsey query', async function () {
    await createDatabase('sqlite') // create database

    // connect to database with loggerConfig
    const db = await require('../multi-db-driver')({
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    // run falsey query
    const result = await db.query({
      falsey: 'select * from test_table'
    })

    await db.endConnection() // end connection
    assert.equal(!!result, false) // check if result is falsey
  })

  it('should print error due to malformed query', async function () {
    await createDatabase('sqlite') // create database

    // connect to database with loggerConfig
    const db = await require('../multi-db-driver')({
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    // run malformed query
    const result = await db.query({
      sqlite: ['select * from test_table']
    })

    await db.endConnection() // end connection
    assert.equal(!!result, false) // check if result is falsey
  })

  it('should print error due to invalid query type', async function () {
    await createDatabase('sqlite') // create database

    // connect to database with loggerConfig
    const db = await require('../multi-db-driver')({
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    const result = await db.query(1) // run invalid type of query
    await db.endConnection() // end connection
    assert.equal(!!result, false) // check if result is falsey
  })

  it('should print an error due to invalid driver', async function () {
    multiDb.drivers.sqlite = 'bad driver' // change MySQL driver

    // connect to database
    const db = await multiDb({
      default: 'sqlite',
      sqlite: {
        config: {
          database: './test/sqlite-db/sqlite_multi_db_tests_database.sqlite'
        }
      },
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    multiDb.drivers.sqlite = 'better-sqlite3' // change SQLite driver back
    await db.endConnection() // end connection
    assert.equal(!!db.sqlite.db, false) // check db.sqlite.db is falsey
  })

  it('should check the "default" member of the query object', async function () {
    await createDatabase('sqlite') // create database

    // connect to database
    const db = await multiDb({
      default: 'sqlite',
      sqlite: {
        config: {
          database: './test/sqlite-db/sqlite_multi_db_tests_database.sqlite'
        }
      },
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    // insert values into table
    for (let i = 0; i < values.length; i++) {
      await db.query(`insert into test_table (
        name,
        description
      ) values (?, ?)`, [values[i].name, values[i].description])
    }

    // run "default" query
    const { rows } = await db.query({
      default: 'select * from test_table'
    })

    await db.endConnection() // end connection
    assert.deepEqual(rows, values) // check if rows from test_table equal inserted values
  })

  // the engine keyed form of the query object used to be covered only as a side effect of the postgres suite, which meant it went untested wherever postgres was unavailable
  it('should check an engine-specific member of the query object', async function () {
    await createDatabase('sqlite') // create database

    // connect to database with loggerConfig
    const db = await require('../multi-db-driver')({
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    // insert values into table
    for (let i = 0; i < values.length; i++) {
      await db.query(`insert into test_table (
        name,
        description
      ) values (?, ?)`, [values[i].name, values[i].description])
    }

    // run a query keyed to the engine in use rather than to "default"
    const { rows } = await db.query({
      sqlite: 'select * from test_table'
    })

    await db.endConnection() // end connection
    assert.deepEqual(rows, values) // check if rows from test_table equal inserted values
  })

  it('should run argument 2 in the query as a post-process function', async function () {
    await createDatabase('sqlite') // create database

    // connect to database
    const db = await multiDb({
      default: 'sqlite',
      sqlite: {
        config: {
          database: './test/sqlite-db/sqlite_multi_db_tests_database.sqlite'
        }
      },
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    // insert values into table
    for (let i = 0; i < values.length; i++) {
      await db.query(`insert into test_table (
        name,
        description
      ) values (?, ?)`, [values[i].name, values[i].description])
    }

    // run query with postprocess function as second argument
    const result = await db.query('select * from test_table', function (db, result) {
      const rows = result.rows
      return rows
    })
    await db.endConnection() // end connection
    assert.deepEqual(result, values) // check if error was printed due to falsey query
  })

  itIf('postgres')('should test database connection using testConnection method', async function () {
    await createDatabase('postgres', 'localhost', 5432) // create database

    // connect to database
    const db = await require('../multi-db-driver')({
      default: 'postgres',
      postgres: {
        config: fixture.configs.postgres.config
      },
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    const result = await db.testConnection() // test connection
    await db.endConnection() // end connection
    assert.equal(!!result, true) // check if connection was successfully tested
  })

  itIf('postgres')('should print error due to failed connection test', async function () {
    await createDatabase('postgres', 'localhost', 5432) // create database
    for (const key in multiDb.defaultCredentials.postgres) multiDb.defaultCredentials.postgres[key].host = 'foo' // change host value in for each credential
    // connect to database
    const db = await multiDb({
      default: 'postgres',
      postgres: {
        config: { ...fixture.configs.postgres.config, host: 'foo' },
        adminConfig: { ...fixture.configs.postgres.adminConfig, host: 'bar' }
      },
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })

    const result = await db.testConnection()

    for (const key in multiDb.defaultCredentials.postgres) multiDb.defaultCredentials.postgres[key].host = 'localhost' // change host values back
    await db.endConnection() // end connection
    assert.equal(!!result, false) // check if result is falsey
  })
})

// which copy of a driver gets loaded needs no server either, only a directory that stands in for an app
describe('Loading drivers', function () {
  const loadDriver = require('../lib/loadDriver')
  const appDir = path.join(os.tmpdir(), `multi-db-driver-load-driver-test-${process.pid}`)
  const originalCwd = process.cwd()

  before(function () {
    // an app with its own copy of pg, which is not the copy multi-db-driver has as a development dependency
    fs.mkdirSync(path.join(appDir, 'node_modules/pg'), { recursive: true })
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { pg: '*' } }))
    fs.writeFileSync(path.join(appDir, 'node_modules/pg/package.json'), JSON.stringify({ name: 'pg', main: 'index.js' }))
    fs.writeFileSync(path.join(appDir, 'node_modules/pg/index.js'), 'module.exports = { appCopy: true }')
  })

  afterEach(function () {
    process.chdir(originalCwd)
  })

  after(function () {
    fs.rmSync(appDir, { recursive: true, force: true })
  })

  it('should load a driver from the app rather than from multi-db-driver when both have it', async function () {
    process.chdir(appDir)
    assert.equal((await loadDriver('pg')).appCopy, true)
  })

  it('should fall back to multi-db-driver\'s own copy of a driver the app does not have', async function () {
    process.chdir(appDir)
    assert.equal(await loadDriver('better-sqlite3'), require('better-sqlite3'))
  })
})

// placeholder rewriting needs no server, so it is tested directly against the rewriter rather than through a connection
describe('Placeholder rewriting for PostgreSQL and PGlite', function () {
  const rewrite = require('../lib/queryParser')

  it('should number ? placeholders in order', function () {
    assert.equal(rewrite('select * from t where a = ? and b = ?'), 'select * from t where a = $1 and b = $2')
  })

  it('should leave the rest of the query exactly as written', function () {
    assert.equal(rewrite('SELECT "MixedCase".Id FROM MixedCase WHERE x = ?'), 'SELECT "MixedCase".Id FROM MixedCase WHERE x = $1')
  })

  it('should ignore ? inside strings, quoted identifiers, and comments', function () {
    assert.equal(rewrite('select \'what?\', \'it\'\'s ?\', "we?ird" from t -- why?\nwhere a = ? /* a /* nested ? */ comment? */'), 'select \'what?\', \'it\'\'s ?\', "we?ird" from t -- why?\nwhere a = $1 /* a /* nested ? */ comment? */')
  })

  it('should honor backslash escapes in E strings', function () {
    assert.equal(rewrite('select E\'a\\\' ?\', ?'), 'select E\'a\\\' ?\', $1')
  })

  it('should ignore ? inside dollar-quoted bodies', function () {
    assert.equal(rewrite('select $$ body ? $$, $fn$ ? $fn$, ?'), 'select $$ body ? $$, $fn$ ? $fn$, $1')
  })

  it('should leave the jsonb ?| and ?& operators alone', function () {
    assert.equal(rewrite('select data ?| array[?], data ?& array[?] from t'), 'select data ?| array[$1], data ?& array[$2] from t')
  })

  it('should leave a query already written with $1 placeholders untouched', function () {
    assert.equal(rewrite('select * from t where a = $1 and b = ?'), 'select * from t where a = $1 and b = ?')
  })
})

// MariaDB tests
// the engines whose tests run against a connection this file opens directly. their tests were four near-identical copies, so they are generated from one place instead: anything genuinely per-engine lives in the spec below, and anything unique to one engine lives in its extraTests. pglite is not in here because its tests run in child processes, which makes them a different shape
const sqlEngines = [
  {
    label: 'MariaDB',
    engine: 'mariadb',
    handle: db => db.mariadb.conn,
    configLocation: './test/configs/.mariadb-config.json', // mariadb has no section in the root config
    badConfig: () => ({
      config: { ...fixture.configs.mariadb.config, host: 'foo' },
      adminConfig: { ...fixture.configs.mariadb.adminConfig, host: 'foo' }
    }),
    // without short timeouts the mariadb driver spends about half a minute giving up on the bad host
    badCredentialExtras: { acquireTimeout: 100, initializationTimeout: 1000 }
  },
  {
    label: 'MySQL',
    engine: 'mysql',
    handle: db => db.mysql.conn,
    badConfig: () => ({
      config: { ...fixture.configs.mysql.config, host: 'foo' },
      adminConfig: { ...fixture.configs.mysql.adminConfig, host: 'foo' }
    })
  },
  {
    label: 'PostgreSQL',
    engine: 'postgres',
    handle: db => db.postgres.client,
    badConfig: () => ({
      config: { ...fixture.configs.postgres.config, host: 'foo' },
      adminConfig: { ...fixture.configs.postgres.adminConfig, host: 'bar' }
    }),
    extraTests (spec) {
      it('should run queries concurrently rather than one at a time', async function () {
        await createDatabase(spec.engine) // create database
        const db = await connectTo(spec)
        const started = Date.now()
        await Promise.all([db.query('select pg_sleep(0.5)'), db.query('select pg_sleep(0.5)')])
        const elapsed = Date.now() - started
        await db.endConnection() // end connection
        assert.ok(elapsed < 900, `two half second queries took ${elapsed}ms, so they ran one after the other`)
      })

      it('should accept native $1 placeholders with questionMarkParamsForPostgres left on', async function () {
        await createDatabase(spec.engine) // create database
        const db = await connectTo(spec)
        await insertEachValue(db, '($1, $2)')
        const result = await db.query('select * from test_table') // select all values from table
        await db.endConnection() // end connection
        assert.deepEqual(result.rows, values) // check if rows match inserted values
      })

      it('should guess credentials always, only in development, or never, as guessCredentials says', async function () {
        await createDatabase(spec.engine) // create database
        const defaults = multiDb.defaultCredentials.postgres
        const saved = structuredClone(defaults)
        const savedNodeEnv = process.env.NODE_ENV
        defaults.splice(0, defaults.length, fixture.configs.postgres.adminConfig) // make the guess one that would succeed

        // whether a connection with bad credentials ends up connected, under a given NODE_ENV and extra options
        async function connects (nodeEnv, options = {}) {
          if (nodeEnv === undefined) delete process.env.NODE_ENV
          else process.env.NODE_ENV = nodeEnv
          const db = await connectTo(spec, { driverConfig: spec.badConfig(), ...options })
          const handle = spec.handle(db)
          await db.endConnection()
          return !!handle
        }

        const results = {
          defaultWithNodeEnvUnset: await connects(undefined),
          defaultInProduction: await connects('production'),
          defaultInDevelopment: await connects('development'),
          alwaysInProduction: await connects('production', { guessCredentials: true }),
          developmentOnlyInProduction: await connects('production', { guessCredentials: 'development' }),
          developmentOnlyInDevelopment: await connects('development', { guessCredentials: 'development' }),
          neverInDevelopment: await connects('development', { guessCredentials: false }),
          unrecognizedInDevelopment: await connects('development', { guessCredentials: 'dev' })
        }

        if (savedNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = savedNodeEnv
        defaults.splice(0, defaults.length, ...saved) // put the real defaults back

        assert.deepEqual(results, {
          defaultWithNodeEnvUnset: false, // a deployment that forgets to set NODE_ENV does not quietly connect as someone else
          defaultInProduction: false,
          defaultInDevelopment: true, // local servers differ between developers, which is what guessing is for
          alwaysInProduction: true,
          developmentOnlyInProduction: false,
          developmentOnlyInDevelopment: true,
          neverInDevelopment: false,
          unrecognizedInDevelopment: false // a typo fails safe rather than guessing
        })
      })

      // postgres natively wants $1 rather than ?, so the driver rewrites placeholders unless this is turned off. that opt-out is only exercised here
      it('should accept native $1 placeholders when questionMarkParamsForPostgres is off', async function () {
        await createDatabase(spec.engine) // create database
        const db = await connectTo(spec, { questionMarkParamsForPostgres: false })

        // insert values into table using postgres placeholder syntax
        for (let i = 0; i < values.length; i++) {
          await db.query(`insert into test_table (
            name,
            description
          ) values ($1, $2)`, [values[i].name, values[i].description])
        }

        const result = await db.query('select * from test_table') // select all values from table
        await db.endConnection() // end connection
        assert.deepEqual(result.rows, values) // check if rows match inserted values
      })
    }
  },
  {
    label: 'SQLite',
    engine: 'sqlite',
    handle: db => db.sqlite.db,
    rollback: false, // sqlite has never had a rollback test
    transaction: { placeholders: '(@name, @description)', perRow: true },
    // sqlite has no host to point at a dead server, so a path that cannot be opened is what makes its config bad
    badConfig: () => ({ config: { database: './test/sqlite-db/path-doesnt-exist/sqlite_multi_db_automated_tests.sqlite' } }),
    extraTests (spec) {
      it('should catch error due to invalid driver', async function () {
        await createDatabase(spec.engine) // create database
        multiDb.drivers.sqlite = 'invalid driver'
        const db = await connectTo(spec)
        multiDb.drivers.sqlite = 'better-sqlite3'
        const result = spec.handle(db)
        await db.endConnection() // end connection
        assert.equal(!!result, false) // check if result is falsey
      })
    }
  }
]

const silentLogger = { log: false, error: false, verbose: false } // tests assert on returned values, not on log output

// open a connection for one engine, optionally overriding the driver config or passing extra top level options
async function connectTo (spec, options = {}) {
  const { driverConfig, ...rest } = options
  return multiDb({
    default: spec.engine,
    [spec.engine]: driverConfig || fixture.configs[spec.engine],
    loggerConfig: silentLogger,
    ...rest
  })
}

// insert the test values one row at a time
async function insertEachValue (db, placeholders = '(?, ?)') {
  for (let i = 0; i < values.length; i++) {
    await db.query(`insert into test_table (
      name,
      description
    ) values ${placeholders}`, [values[i].name, values[i].description])
  }
}

for (const spec of sqlEngines) {
  describeIf(spec.engine)(spec.label, function () {
    beforeEach(function () {
      if (spec.configLocation) process.env.MULTI_DB_DRIVER_CONFIG_LOCATION = spec.configLocation // env var for config location
    })

    afterEach(async function () {
      await destroyDatabase(spec.engine)
      delete process.env.MULTI_DB_DRIVER_CONFIG_LOCATION // delete env var
    })

    it('should insert values into table', async function () {
      await createDatabase(spec.engine) // create database
      const db = await connectTo(spec)
      await insertEachValue(db) // insert values into table
      const result = await db.query('select * from test_table') // select all values from table
      await db.endConnection() // end connection
      assert.deepEqual(result.rows, values) // check if rows match inserted values
    })

    it('should insert array of objects into table using a transaction', async function () {
      await createDatabase(spec.engine) // create database
      const db = await connectTo(spec)
      const transaction = spec.transaction || {}
      const placeholders = transaction.placeholders || '(?, ?)'

      // insert values into table. most drivers take the whole array in one call; sqlite binds named params a row at a time
      if (transaction.perRow) {
        for (let i = 0; i < values.length; i++) {
          await db.query(`insert into test_table (
            name,
            description
          ) values ${placeholders}`, values)
        }
      } else {
        await db.query(`insert into test_table (
          name,
          description
        ) values ${placeholders}`, values)
      }

      const result = await db.query('select * from test_table') // select all values from table
      await db.endConnection() // end connection
      assert.deepEqual(result.rows, values) // check if rows match inserted values
    })

    it('should run a single insert whose first value is null as one query rather than as a transaction', async function () {
      await createDatabase(spec.engine) // create database
      const db = await connectTo(spec)
      await db.query('insert into test_table (description, name) values (?, ?)', [null, 'magnus'])
      const result = await db.query('select * from test_table') // select all values from table
      await db.endConnection() // end connection
      assert.deepEqual(result.rows, [{ name: 'magnus', description: null }]) // one row, with the null stored as a value
    })

    it('should delete all values from table', async function () {
      await createDatabase(spec.engine) // create database
      const db = await connectTo(spec)
      await insertEachValue(db) // insert values into table
      await db.query('delete from test_table') // delete values from table
      const result = await db.query('select * from test_table') // select all values from table
      await db.endConnection() // end connection
      assert.equal(result.rows.length, 0) // check if table has 0 rows
    })

    if (spec.rollback !== false) {
      it('should roll back transaction due to error', async function () {
        await createDatabase(spec.engine) // create database
        const db = await connectTo(spec)
        const dbBeforeState = await db.query('select * from test_table') // select all values from table

        // insert values into table with a typo, so the transaction has to roll back
        await db.query(`inser into test_table (
          name,
          description
        ) values (?, ?)`, values)

        const dbAfterState = await db.query('select * from test_table') // select all values from table
        await db.endConnection() // end connection
        assert.deepEqual(dbAfterState.rows, dbBeforeState.rows) // check if the table was left as it was found
      })
    }

    it('should print errors due to invalid SQL syntax', async function () {
      await createDatabase(spec.engine) // create database

      // run query with invalid syntax
      const result = await runQueryWithInvalidSyntax({
        default: spec.engine,
        [spec.engine]: fixture.configs[spec.engine],
        loggerConfig: silentLogger
      })

      assert.ok(result.error) // an invalid query resolves to the error rather than rows
    })

    it('should print errors due to bad config', async function () {
      await createDatabase(spec.engine) // create database
      const defaults = multiDb.defaultCredentials[spec.engine]

      // point the fallback credentials somewhere dead too, so the driver cannot quietly rescue the bad config by guessing
      for (const key in defaults) Object.assign(defaults[key], { host: 'foo' }, spec.badCredentialExtras)

      const db = await connectTo(spec, { driverConfig: spec.badConfig() })
      for (const key in defaults) defaults[key].host = 'localhost' // change host values back
      const result = spec.handle(db)
      await db.endConnection() // end connection
      assert.equal(!!result, false) // check if result is falsey
    })

    if (spec.extraTests) spec.extraTests(spec)
  })
}

// PGlite tests
describe('PGlite', function () {
  afterEach(async function () {
    await destroyDatabase('pglite')
  })

  it('should insert values into table', async function () {
    const insertValues = spawnSync('node', ['./test/util/insertValuesIntoPgliteTable.js'], plainOutput)
    const result = insertValues.stdout.toString()
    assert.deepEqual(result.trimEnd(), JSON.stringify(values))
  })

  it('should insert array of objects into table using a transaction', async function () {
    const insertValues = spawnSync('node', ['./test/util/insertValuesIntoPgliteTable.js', '--transaction'], plainOutput)
    const result = insertValues.stdout.toString()
    assert.deepEqual(result.trimEnd(), JSON.stringify(values))
  })

  it('should delete all values from table', async function () {
    const deleteValues = spawnSync('node', ['./test/util/deleteValuesFromPgliteTable.js'], plainOutput)
    const result = deleteValues.stdout.toString()
    assert.equal(result.trimEnd(), '[]')// check if table has 0 rows
  })

  it('should roll back transaction due to error', async function () {
    const insertValues = spawnSync('node', ['./test/util/insertValuesIntoPgliteTable.js', '--transaction-rollback'], plainOutput)
    const result = insertValues.stdout.toString()
    const splitResult = result.trimEnd().split(' ')
    assert.deepEqual(splitResult[0], splitResult[1])
  })

  it('should print errors due to invalid SQL syntax', async function () {
    const printInvalidSqlErrors = spawnSync('node', ['./test/util/printPgliteErrorsDueToInvalidSql.js'], plainOutput)
    const result = JSON.parse(printInvalidSqlErrors.stdout.toString())
    assert.ok(result.error) // an invalid query resolves to the error rather than rows
  })

  it('should print errors due to bad config', async function () {
    const printBadConfigErrors = spawnSync('node', ['./test/util/printPgliteErrorsDueToBadConfig.js'], plainOutput)
    const result = printBadConfigErrors.stdout.toString()
    assert.equal(result.trimEnd(), 'undefined') // check if result equals undefined
  })
})
