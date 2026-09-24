const process = require('process')
const fs = require('fs')
const isCli = process.argv[1]?.slice(-6) === 'cli.js' // argv[1] is undefined in the repl and under node -e, where there is no script path
const Logger = require('roosevelt-logger')
const configFinder = require('./lib/configFinder')
const resolvePath = require('./lib/resolvePath')
const queryParser = require('./lib/queryParser')
const loadDriver = require('./lib/loadDriver')

async function multiDb (params) {
  const logger = new Logger()

  const config = await configFinder(logger, params) // find config

  if (config.loggerConfig) {
    if (config.loggerConfig.log === false) logger.log = function () {}
    if (config.loggerConfig.warn === false) logger.warn = function () {}
    if (config.loggerConfig.error === false) logger.error = function () {}
    if (config.loggerConfig.verbose === false) logger.verbose = function () {}
  }

  // attempt to load all the db drivers
  //
  // a driver that is still a string here has not been loaded yet, so a failure means its package is genuinely absent. on a later call the entry already holds the loaded module, and the load is skipped rather than counted as missing
  const missingDrivers = {}
  const connectionFailures = {} // why each set of credentials an engine tried could not connect, reported if none of them could
  for (const key in multiDb.drivers) {
    const packageName = typeof multiDb.drivers[key] === 'string' ? multiDb.drivers[key] : null
    try {
      if (packageName) multiDb.drivers[key] = await loadDriver(packageName) // loaded from the app, which is what installs the drivers
    } catch (e) {
      if (packageName) missingDrivers[key] = packageName
      // the module isn't in node_modules. this is only worth logging here in a verbose mode: whether it matters depends on whether the config actually asks for that database, which is reported per engine below
      logger.verbose(`${key} driver ${multiDb.drivers[key]} could not be loaded.`)
    }
  }

  // a query against an engine that never initialized would otherwise fail deep inside the driver with something like "cannot read properties of undefined", which tells the caller nothing about the real cause
  //
  // returns the error result to hand back, or null when the engine is fine
  function notInitialized (engine, emoji, label, handle) {
    if (handle) return null
    const missing = missingDrivers[engine]
    const reason = missing
      ? `its driver is not installed. Run: npm i ${installNameFor(missing)}`
      : 'it is not connected. Check the errors above for why the connection could not be established.'
    const error = new Error(`Cannot query ${label}: ${reason}`)
    logger.error(emoji, error.message)
    return { error }
  }

  // explain why an engine could not start. a driver package that is not installed needs completely different advice from a connection that was refused, and telling someone to check their config when the config is fine sends them to debug the wrong thing
  function reportInitFailure (engine, emoji, label) {
    const missing = missingDrivers[engine]
    if (missing) logger.error(emoji, `Cannot use ${label}: its driver is not installed. Run: npm i ${installNameFor(missing)}`)
    else logger.error(emoji, `Could not initialize ${label} module. Please make sure it is configured properly.${connectionFailures[engine]?.length ? ' Connection attempts: ' + connectionFailures[engine].join('; ') : ''}`)
  }

  // normalize all db drivers to one api and initialize the db drivers
  const db = {
    config,
    drivers: multiDb.drivers
  }
  let connected

  // the shared identity of each engine: how it is named in logs, and where its live handle lives once connected
  const engines = {
    mariadb: { engine: 'mariadb', emoji: '🦭', label: 'MariaDB', handle: () => db.mariadb.pool },
    mysql: { engine: 'mysql', emoji: '🐬', label: 'MySQL', handle: () => db.mysql.pool },
    pglite: { engine: 'pglite', emoji: '⚡️', label: 'PGlite', handle: () => db.pglite.db },
    postgres: { engine: 'postgres', emoji: '🐘', label: 'PostgreSQL', handle: () => db.postgres.pool },
    sqlite: { engine: 'sqlite', emoji: '🪶', label: 'SQLite', handle: () => db.sqlite.db }
  }

  // an array of rows, each one an array or a plain object, means the caller wants each row run as one transaction. selects are excluded because there is nothing to commit
  //
  // every param has to be a row for this to count. checking only the first one used to treat a single insert whose first value was null, a date, or a buffer as a transaction, which ran it once per value and threw on the null
  function isTransaction (query, params) {
    if (query.trim().toLowerCase().startsWith('select') || !Array.isArray(params) || !params.length) return false
    return params.every(param => Array.isArray(param) || (param !== null && Object.getPrototypeOf(param) === Object.prototype))
  }

  // a transaction's params arrive as either objects or arrays, and most drivers want positional values either way
  function positional (param) {
    return Array.isArray(param) ? param : Object.values(param)
  }

  // connect with the configured credentials. when guessing is on, the common default credentials are tried next, then whichever of the admin or regular credentials was not tried first. the first set that connects wins and the rest are never attempted
  //
  // guessCredentials is true to always guess, 'development' to guess only when NODE_ENV is development, or false to never guess. apps default to 'development', which is where developers' local servers differ from one another, because a deployed app whose own credentials fail would otherwise quietly connect as a superuser, possibly to another database entirely, which is a worse failure than not connecting. the cli defaults to true, since it is what runs with admin credentials during setup
  //
  // NODE_ENV is used because it is the convention most node tooling already follows, rather than anything specific to one framework. an unset NODE_ENV does not count as development, so a deployment that forgets to set it fails safe
  //
  // open receives the credentials and throws if it cannot connect. it is responsible for closing anything it opened before throwing, so that a failed attempt does not leave a pool behind
  async function connectWithLadder (spec, open) {
    const name = spec.engine
    if (!config[name]) return false
    const configured = config.admin ? config[name].adminConfig : config[name].config // default to admin config if the admin flag is passed
    const credentialsToTry = [configured]
    if (guessCredentials) {
      credentialsToTry.push(
        ...multiDb.defaultCredentials[name], // try some default credentials if the configured ones don't work
        config.admin ? config[name].config : config[name].adminConfig // if none of those worked, try either the admin credentials or the user credentials, whichever wasn't used above
      )
    }
    const failures = connectionFailures[name] = []
    for (const credentials of credentialsToTry) {
      if (!credentials) continue // an adminConfig or config that was never supplied
      try {
        await open(credentials)
        if (credentials !== configured) logger.warn('⚠️', `${spec.emoji} ${spec.label} could not connect with the configured credentials, so it connected with guessed credentials instead: user ${credentials.user}, database ${credentials.database}`)
        logger.log(spec.emoji, `${spec.label} database connected with user ${credentials.user} to database ${credentials.database}`)
        db[name].username = credentials.user
        db[name].database = credentials.database
        return true
      } catch (e) {
        failures.push(`user ${credentials.user} on ${credentials.host || 'localhost'}${credentials.port ? ':' + credentials.port : ''}: ${String(e.message || e.code || e).split('\n')[0]}`) // first line only, so the report stays on one line
      }
    }
    return false
  }

  // resolves guessCredentials to whether this connection should guess. a value that is not one of the three recognized ones is reported and treated as false, because guessing by mistake is the unsafe direction to fail in
  function shouldGuessCredentials () {
    const setting = config.guessCredentials ?? (isCli ? true : 'development')
    if (setting === true || setting === false) return setting
    if (setting === 'development') return process.env.NODE_ENV === 'development'
    logger.error(`guessCredentials must be true, false, or 'development', but it is set to ${JSON.stringify(setting)}, so credentials will not be guessed.`)
    return false
  }
  const guessCredentials = shouldGuessCredentials() // resolved once, so a bad value is reported once rather than once per database

  // postgres and pglite want $1 style placeholders, so a query written with ? is rewritten for them
  function rewriteForPostgres (query, skipRewrite) {
    if (config.questionMarkParamsForPostgres === false || skipRewrite) return query
    return queryParser(query)
  }

  // opens a pool and proves the credentials work by checking a connection out of it and handing it straight back. queries then go through the pool, so they can run concurrently and a dropped connection is replaced instead of breaking every query after it
  async function openPool (createPool, checkOut, credentials) {
    const pool = await createPool(credentials)
    try {
      const connection = await checkOut(pool)
      await connection.release()
      return pool
    } catch (e) {
      await pool.end().catch(() => {}) // a pool whose credentials failed would otherwise keep the process alive
      throw e
    }
  }

  // runs one query per row inside a transaction on a single checked-out connection, because a transaction only means anything if every statement in it goes over the same connection
  async function transaction (connection, { begin, commit, rollback }, query, params) {
    try {
      await begin()
      for (const param of params) await connection.query(query, positional(param))
      await commit()
    } catch (e) {
      await rollback()
      throw e
    } finally {
      await connection.release()
    }
  }

  // every engine reports a query failure the same way, and none of them may let a driver level exception escape to the caller
  async function runQuery (spec, query, params, run) {
    const uninitialized = notInitialized(spec.engine, spec.emoji, spec.label, spec.handle())
    if (uninitialized) return uninitialized
    try {
      return await run()
    } catch (e) {
      logger.error(spec.emoji, `${spec.label} query error...`)
      logger.error('Query attempted: ', query)
      logger.error('Params supplied: ', params)
      logger.error(e)
      return { error: e }
    }
  }

  db.mariadb = {}
  connected = await connectWithLadder(engines.mariadb, async credentials => {
    if (isCli) {
      credentials.multipleStatements = true
      credentials.allowPublicKeyRetrieval = true
    }
    const { createPool } = multiDb.drivers.mariadb
    db.mariadb.pool = await openPool(createPool, pool => pool.getConnection(), credentials)
    db.mariadb.conn = db.mariadb.pool // the pool answers query() the same way the single connection this used to be did, so code reaching for conn keeps working
  })
  if (!connected && config.mariadb) reportInitFailure('mariadb', engines.mariadb.emoji, 'MariaDB')
  db.mariadb.query = async (query, params) => runQuery(engines.mariadb, query, params, async () => {
    let result
    if (isTransaction(query, params)) {
      const conn = await db.mariadb.pool.getConnection()
      await transaction(conn, { begin: () => conn.beginTransaction(), commit: () => conn.commit(), rollback: () => conn.rollback() }, query, params)
    } else {
      result = await db.mariadb.pool.query(query, params)
    }
    return { rows: result }
  })

  db.mysql = {}
  connected = await connectWithLadder(engines.mysql, async credentials => {
    if (isCli) credentials.multipleStatements = true
    const { createPool } = multiDb.drivers.mysql
    db.mysql.pool = await openPool(createPool, pool => pool.getConnection(), credentials)
    db.mysql.conn = db.mysql.pool // the pool answers query() the same way the single connection this used to be did, so code reaching for conn keeps working
  })
  if (!connected && config.mysql) reportInitFailure('mysql', engines.mysql.emoji, 'MySQL')
  db.mysql.query = async (query, params) => runQuery(engines.mysql, query, params, async () => {
    let result
    if (isTransaction(query, params)) {
      const conn = await db.mysql.pool.getConnection()
      await transaction(conn, { begin: () => conn.beginTransaction(), commit: () => conn.commit(), rollback: () => conn.rollback() }, query, params)
    } else {
      result = await db.mysql.pool.query(query, params)
    }
    // mysql2 hands back [rows, fields], so the rows are surfaced alongside the whole response rather than in place of it
    const wrapped = { full: result }
    wrapped.rows = wrapped.full?.[0]
    return wrapped
  })

  db.pglite = {}
  if (config.default === 'pglite' || config.pglite) {
    connected = false
    if ((isCli && config.default === 'pglite') || fs.existsSync(resolvePath(config.pglite.config.database))) {
      const { PGlite } = multiDb.drivers.pglite
      db.pglite.db = new PGlite(resolvePath(config.pglite.config.database))
      logger.log(engines.pglite.emoji, 'PGlite database connected to database ' + config.pglite.config.database)
      db.pglite.database = config.pglite.config.database
      connected = true
    }
    if (!connected && config.pglite) reportInitFailure('pglite', engines.pglite.emoji, 'PGlite')
  }
  db.pglite.query = async (query, params, skipRewrite) => runQuery(engines.pglite, query, params, async () => {
    if (isCli) return await db.pglite.db.exec(query)
    const queryToUse = rewriteForPostgres(query, skipRewrite)
    if (isTransaction(query, params)) {
      await db.pglite.db.transaction(async (tx) => {
        try {
          for (const param of params) await tx.query(queryToUse, positional(param))
        } catch (e) {
          await tx.rollback()
          throw e
        }
      })
    } else {
      return await db.pglite.db.query(queryToUse, params)
    }
  })

  db.postgres = {}
  connected = await connectWithLadder(engines.postgres, async credentials => {
    const { Pool } = multiDb.drivers.postgres
    db.postgres.pool = await openPool(creds => new Pool(creds), pool => pool.connect(), credentials)

    // an idle client that loses its connection emits an error on the pool, which crashes the process if nothing is listening. the pool throws that client away and opens a new one for the next query
    db.postgres.pool.on('error', (e) => {
      logger.error(engines.postgres.emoji, 'PostgreSQL error...')
      logger.error(e)
    })
    db.postgres.client = db.postgres.pool // the pool answers query() the same way the single client this used to be did, so code reaching for client keeps working
  })
  if (!connected && config.postgres) reportInitFailure('postgres', engines.postgres.emoji, 'PostgreSQL')
  db.postgres.query = async (query, params, skipRewrite) => runQuery(engines.postgres, query, params, async () => {
    const queryToUse = rewriteForPostgres(query, skipRewrite)
    if (isTransaction(query, params)) {
      const client = await db.postgres.pool.connect()
      await transaction(client, { begin: () => client.query('BEGIN'), commit: () => client.query('COMMIT'), rollback: () => client.query('ROLLBACK') }, queryToUse, params)
    } else {
      return await db.postgres.pool.query(queryToUse, params)
    }
  })

  db.sqlite = {}
  if (config.default === 'sqlite' || config.sqlite) {
    connected = false
    try {
      const Database = multiDb.drivers.sqlite
      if (config.default === 'sqlite' && isCli) {
        db.sqlite.db = new Database(resolvePath(config.sqlite.config.database))
        db.sqlite.db.pragma('journal_mode = WAL') // enable WAL
      } else {
        db.sqlite.db = new Database(resolvePath(config.sqlite.config.database), { fileMustExist: true })
      }
      logger.log(engines.sqlite.emoji, 'SQLite database connected to database ' + config.sqlite.config.database)
      db.sqlite.database = config.sqlite.config.database
      connected = true
    } catch (e) {
      // do nothing
    }
    if (!connected && config.sqlite) reportInitFailure('sqlite', engines.sqlite.emoji, 'SQLite')
  }
  db.sqlite.query = async (query, params) => runQuery(engines.sqlite, query, params, async () => {
    if (isCli) return await db.sqlite.db.exec(query)
    let result
    if (!query.trim().toLowerCase().startsWith('select')) {
      if (isTransaction(query, params)) {
        // it's an array of objects or an array of arrays, so perform a transaction. the params are passed through untouched because sqlite binds named parameters such as @name from the object itself
        const transaction = await db.sqlite.db.prepare(query)
        const transactionRunner = await db.sqlite.db.transaction((paramsArray) => {
          for (const param of paramsArray) transaction.run(param)
        })
        result = transactionRunner(params)
      } else {
        result = await db.sqlite.db.prepare(query).run(params || [])
      }
    } else {
      result = await db.sqlite.db.prepare(query).all(params || [])
    }
    return { rows: result }
  })

  // expose each loaded driver module, as documented, so callers can reach the underlying library directly. an entry that is still a string never loaded, so it is left undefined rather than handing back a package name
  for (const name of Object.keys(engines)) {
    if (typeof multiDb.drivers[name] !== 'string') db[name].driver = multiDb.drivers[name]
  }

  const defaultDb = config.default
  db.driver = db[defaultDb].driver

  // universal query method
  db.query = async (query, params, postprocess) => {
    if (!params || !Array.isArray(params)) {
      if (typeof params === 'function' && !postprocess) {
        // params argument was skipped but the postprocess argument was not. that means argument 2 is our postprocess function and params needs to be set to an empty array
        postprocess = params
      }
      params = [] // regardless of if the above if statement returns true or false, params being set to something other than an array is bad so we need to make sure it's an array
    }
    if (!postprocess || typeof postprocess !== 'function') {
      // postprocess argument was not provided, supply a passthrough function instead
      postprocess = (db, result) => {
        return result
      }
    }
    if (typeof query === 'string') {
      // query string passed, execute it against default db
      const result = await db[defaultDb].query(query, params)
      return postprocess(defaultDb, result)
    } else if (typeof query === 'object') {
      // query object passed
      if (typeof query[defaultDb] === 'string') {
        // execute the query string for the default db if it is specified
        const result = await db[defaultDb].query(query[defaultDb], params, query.disableQuestionMarkParamsForPostgres)
        return postprocess(defaultDb, result)
      } else if (typeof query.default === 'string') {
        // no query string specified for the default db, check the "default" member of the query object instead
        const result = await db[defaultDb].query(query.default, params, query.disableQuestionMarkParamsForPostgres)
        return postprocess(defaultDb, result)
      } else if (!query[defaultDb]) {
        // neither the default db query string nor a default query string is specified
        logger.error('db.query called with argument that was falsey.')
      } else {
        logger.error('db.query called with argument malformed argument.')
      }
    } else {
      logger.error('db.query called with argument malformed argument.')
    }
  }

  // universal test conenction method
  db.testConnection = async () => {
    logger.log('🔌', `Testing ${defaultDb} connection...`)
    const result = await db[defaultDb].query('select 1')
    if (result && !result.error) { // a query that failed resolves to { error }, which is truthy
      logger.log('✅', (`Successfully connected to ${db[defaultDb].database}.`))
      return result
    } else {
      logger.error('Connection failed.')
    }
  }

  // universal end connection method
  db.endConnection = async () => {
    const closers = {
      mariadb: async () => await db.mariadb.pool.end(),
      mysql: async () => await db.mysql.pool.end(),
      pglite: async () => await db.pglite.db.close(),
      postgres: async () => await db.postgres.pool.end(),
      sqlite: async () => await db.sqlite.db.close()
    }
    for (const name of Object.keys(closers)) {
      if (!engines[name].handle()) continue // never connected, so there is nothing to close
      await closers[name]()
      logger.log('🔚', `${engines[name].label} connection ended.`)
    }
  }

  return db
}

// the package to install is not always the path that gets required: mysql2/promise lives inside the mysql2 package
function installNameFor (requirePath) {
  const parts = requirePath.split('/')
  return requirePath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

// declare supported db modules. each entry is replaced with the loaded module on first use, and left as the package name if that package is not installed
multiDb.drivers = {
  mariadb: 'mariadb',
  mysql: 'mysql2/promise',
  pglite: '@electric-sql/pglite',
  postgres: 'pg',
  sqlite: 'better-sqlite3'
  // TODO: add support for more databases?
}

multiDb.defaultCredentials = {
  mariadb: [
    {
      host: 'localhost',
      port: 3306,
      user: 'mariadb',
      password: '',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: 'admin',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: '',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'mariadb',
      password: 'mariadb',
      database: 'mariadb'
    }
  ],
  mysql: [
    {
      host: 'localhost',
      port: 3306,
      user: 'mysql',
      password: '',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: 'admin',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: '',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'mysql',
      password: 'mysql',
      database: 'mysql'
    }
  ],
  postgres: [
    {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: ' ',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'admin',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'admin',
      password: 'admin',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'admin',
      password: 'postgres',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres'
    }
  ]
}
// constructor; returns a db object
module.exports = multiDb
