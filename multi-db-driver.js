const process = require('process')
const path = require('path')
const fs = require('fs')
const isCli = process.argv[1].slice(-6) === 'cli.js'
const Logger = require('roosevelt-logger')
const configFinder = require('./lib/configFinder')
const queryParser = require('./lib/queryParser')

async function multiDb (params) {
  const logger = new Logger()

  const config = await configFinder(logger, params) // find config

  if (config.loggerConfig) {
    if (config.loggerConfig.log === false) logger.log = function () {}
    if (config.loggerConfig.error === false) logger.error = function () {}
    if (config.loggerConfig.verbose === false) logger.verbose = function () {}
  }

  // attempt to load all the db drivers
  for (const key in multiDb.drivers) {
    try {
      if (multiDb.drivers[key] === '@electric-sql/pglite') {
        multiDb.drivers[key] = await import(multiDb.drivers[key])
      } else if (Object.getPrototypeOf(multiDb.drivers[key]) === null) {
        // do  nothing
      } else {
        multiDb.drivers[key] = require(multiDb.drivers[key])
      }
    } catch (e) {
      // the module isn't in node_modules, fail silently
      // log that this db couldn't be initiatlized in a verbose logging mode only
      logger.verbose(`${key} driver ${multiDb.drivers[key]} could not be initialized. Setting it to null.`)
    }
  }

  // normalize all db drivers to one api and initialize the db drivers
  const db = {
    config,
    drivers: multiDb.drivers,
    modifiedQueryCache: {}
  }
  let credentialsToTry
  let connected

  db.mariadb = {}
  if (config.mariadb) {
    credentialsToTry = [
      config.admin ? config.mariadb.adminConfig : config.mariadb.config, // default to admin config if the admin flag is passed
      // try some default credentials if the above doesn't work
      ...multiDb.defaultCredentials.mariadb,
      // if none of those worked, try either the admin credentials or the user credentials, whichever wasn't used above
      config.admin ? config.mariadb.config : config.mariadb.adminConfig
    ]
  } else {
    credentialsToTry = []
  }
  connected = false
  for (let i = 0; i < credentialsToTry.length; i++) {
    try {
      if (isCli) {
        credentialsToTry[i].multipleStatements = true
        credentialsToTry[i].allowPublicKeyRetrieval = true
      }
      const { createPool } = multiDb.drivers.mariadb
      db.mariadb.pool = await createPool(credentialsToTry[i])
      db.mariadb.conn = await db.mariadb.pool.getConnection()
      logger.log('🦭', ('MariaDB database connected with user ' + credentialsToTry[i].user + ' to database ' + credentialsToTry[i].database).bold)
      db.mariadb.username = credentialsToTry[i].user
      db.mariadb.database = credentialsToTry[i].database
      connected = true
      break
    } catch (e) {
      // do nothing, try the next set of credentials
    }
  }
  if (!connected && config.mariadb) {
    logger.error('🦭', 'Could not initialize MariaDB module. Please make sure it is configured properly.')
  }
  db.mariadb.query = async (query, params) => {
    try {
      let result
      if (!query.trim().toLowerCase().startsWith('select') && params && typeof params[0] === 'object') {
        // it's an array of objects or an array of arrays, so perform a transaction
        try {
          await db.mariadb.conn.beginTransaction()
          for (let param of params) {
            if (!Array.isArray(param)) param = Object.values(param)
            await db.mariadb.conn.query(query, param)
          }
          await db.mariadb.conn.commit()
        } catch (e) {
          await db.mariadb.conn.rollback()
          throw e
        }
      } else {
        result = await db.mariadb.conn.query(query, params)
      }
      result = {
        rows: result
      }
      return result
    } catch (e) {
      logger.error('🦭', 'MariaDB query error...')
      logger.error('Query attempted: ', query)
      logger.error('Params supplied: ', params)
      logger.error(e)
      return { error: e }
    }
  }

  db.mysql = {}
  if (config.mysql) {
    credentialsToTry = [
      config.admin ? config.mysql.adminConfig : config.mysql.config, // default to admin config if the admin flag is passed
      // try some default credentials if the above doesn't work
      ...multiDb.defaultCredentials.mysql,
      // if none of those worked, try either the admin credentials or the user credentials, whichever wasn't used above
      config.admin ? config.mysql.config : config.mysql.adminConfig
    ]
  } else {
    credentialsToTry = []
  }
  connected = false
  for (let i = 0; i < credentialsToTry.length; i++) {
    try {
      if (isCli) credentialsToTry[i].multipleStatements = true
      const { createPool } = multiDb.drivers.mysql
      db.mysql.pool = await createPool(credentialsToTry[i])
      db.mysql.conn = await db.mysql.pool.getConnection()
      logger.log('🐬', ('MySQL database connected with user ' + credentialsToTry[i].user + ' to database ' + credentialsToTry[i].database).bold)
      db.mysql.username = credentialsToTry[i].user
      db.mysql.database = credentialsToTry[i].database
      connected = true
      break
    } catch (e) {
      // do nothing, try the next set of credentials
    }
  }
  if (!connected && config.mysql) {
    logger.error('🐬', 'Could not initialize MySQL module. Please make sure it is configured properly.')
  }
  db.mysql.query = async (query, params) => {
    try {
      let result
      if (!query.trim().toLowerCase().startsWith('select') && params && typeof params[0] === 'object') {
        // it's an array of objects or an array of arrays, so perform a transaction
        try {
          await db.mysql.conn.beginTransaction()
          for (let param of params) {
            if (!Array.isArray(param)) param = Object.values(param)
            await db.mysql.conn.query(query, param)
          }
          await db.mysql.conn.commit()
        } catch (e) {
          await db.mysql.conn.rollback()
          throw e
        }
      } else {
        result = await db.mysql.conn.query(query, params)
      }
      result = {
        full: result
      }
      result.rows = result.full?.[0]
      return result
    } catch (e) {
      logger.error('🐬', 'MySQL query error...')
      logger.error('Query attempted: ', query)
      logger.error('Params supplied: ', params)
      logger.error(e)
      return { error: e }
    }
  }

  db.pglite = {}
  if (config.default === 'pglite' || config.pglite) {
    connected = false
    if ((isCli && config.default === 'pglite') || fs.existsSync(path.normalize(config.pglite.config.database))) {
      const { PGlite } = multiDb.drivers.pglite
      db.pglite.db = new PGlite(config.pglite.config.database)
      logger.log('⚡️', ('PGlite database connected to database ' + config.pglite.config.database).bold)
      db.pglite.database = config.pglite.config.database
      connected = true
    }
    if (!connected && config.pglite) {
      logger.error('⚡️', 'Could not initialize PGlite module. Please make sure it is configured properly.')
    }
  }
  db.pglite.query = async (query, params, skipAST) => {
    try {
      if (isCli) return await db.pglite.db.exec(query)
      if (config.questionMarkParamsForPostgres === false) skipAST = true
      let modifiedQuery
      if (!skipAST) {
        if (db.modifiedQueryCache[query]) {
          modifiedQuery = db.modifiedQueryCache[query]
        } else {
          try {
            modifiedQuery = await queryParser(query)
          } catch (e) {
            // do nothing
          }
        }
      }
      let queryToUse
      if (modifiedQuery) {
        db.modifiedQueryCache[query] = modifiedQuery
        queryToUse = modifiedQuery
      } else queryToUse = query
      if (!query.trim().toLowerCase().startsWith('select') && params && typeof params[0] === 'object') {
        // it's an array of objects or an array of arrays, so perform a transaction
        await db.pglite.db.transaction(async (tx) => {
          try {
            for (let param of params) {
              if (!Array.isArray(param)) param = Object.values(param)
              await tx.query(queryToUse, param)
            }
          } catch (e) {
            await tx.rollback()
            throw e
          }
        })
      } else {
        return await db.pglite.db.query(queryToUse, params)
      }
    } catch (e) {
      logger.error('⚡️', 'PGlite query error...')
      logger.error('Query attempted: ', query)
      logger.error('Params supplied: ', params)
      logger.error(e)
      return { error: e }
    }
  }

  db.postgres = {}
  if (config.postgres) {
    credentialsToTry = [
      config.admin ? config.postgres.adminConfig : config.postgres.config, // default to admin config if the admin flag is passed
      // try some default credentials if the above doesn't work
      ...multiDb.defaultCredentials.postgres,
      // if none of those worked, try either the admin credentials or the user credentials, whichever wasn't used above
      config.admin ? config.postgres.config : config.postgres.adminConfig
    ]
  } else {
    credentialsToTry = []
  }
  connected = false
  for (let i = 0; i < credentialsToTry.length; i++) {
    try {
      const { Pool } = multiDb.drivers.postgres
      db.postgres.pool = new Pool(credentialsToTry[i])
      db.postgres.client = await db.postgres.pool.connect()
      db.postgres.client.on('error', (e) => {
        logger.error('🐘', 'PostgreSQL error...')
        logger.error(e)
      })
      logger.log('🐘', ('PostgreSQL database connected with user ' + credentialsToTry[i].user + ' to database ' + credentialsToTry[i].database).bold)
      db.postgres.username = credentialsToTry[i].user
      db.postgres.database = credentialsToTry[i].database
      connected = true
      break
    } catch (e) {
      // fail silently, try the next set of credentials
    }
  }
  if (!connected && config.postgres) {
    logger.error('🐘', 'Could not initialize PostgreSQL module. Please make sure it is configured properly.')
  }
  db.postgres.query = async (query, params, skipAST) => {
    try {
      if (config.questionMarkParamsForPostgres === false) skipAST = true
      let modifiedQuery
      if (!skipAST) {
        if (db.modifiedQueryCache[query]) {
          modifiedQuery = db.modifiedQueryCache[query]
        } else {
          try {
            modifiedQuery = await queryParser(query)
          } catch (e) {
            // do nothing
          }
        }
      }
      let queryToUse
      if (modifiedQuery) {
        db.modifiedQueryCache[query] = modifiedQuery
        queryToUse = modifiedQuery
      } else queryToUse = query
      if (!query.trim().toLowerCase().startsWith('select') && params && typeof params[0] === 'object') {
        // it's an array of objects or an array of arrays, so perform a transaction
        try {
          await db.postgres.client.query('BEGIN')
          for (let param of params) {
            if (!Array.isArray(param)) param = Object.values(param)
            await db.postgres.client.query(queryToUse, param)
          }
          await db.postgres.client.query('COMMIT')
        } catch (e) {
          await db.postgres.client.query('ROLLBACK')
          throw e
        }
      } else {
        return await db.postgres.client.query(queryToUse, params)
      }
    } catch (e) {
      logger.error('🐘', 'PostgreSQL query error...')
      logger.error('Query attempted: ', query)
      logger.error('Params supplied: ', params)
      logger.error(e)
      return { error: e }
    }
  }

  db.sqlite = {}
  if (config.default === 'sqlite' || config.sqlite) {
    connected = false
    try {
      const Database = multiDb.drivers.sqlite
      if (config.default === 'sqlite' && isCli) {
        db.sqlite.db = new Database(config.sqlite.config.database)
        db.sqlite.db.pragma('journal_mode = WAL') // enable WAL
      } else {
        db.sqlite.db = new Database(config.sqlite.config.database, { fileMustExist: true })
      }
      logger.log('🪶', ('SQLite database connected to database ' + config.sqlite.config.database).bold)
      db.sqlite.database = config.sqlite.config.database
      connected = true
    } catch (e) {
      // do nothing
    }
    if (!connected && config.sqlite) {
      logger.error('🪶', 'Could not initialize SQLite module. Please make sure it is configured properly.')
    }
  }
  db.sqlite.query = async (query, params) => {
    try {
      let result
      if (isCli) result = await db.sqlite.db.exec(query)
      else {
        if (!query.trim().toLowerCase().startsWith('select')) {
          if (params && typeof params[0] === 'object') {
            // it's an array of objects or an array of arrays, so perform a transaction
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
        result = {
          rows: result
        }
      }
      return result
    } catch (e) {
      logger.error('🪶', 'SQLite query error...')
      logger.error('Query attempted: ', query)
      logger.error('Params supplied: ', params)
      logger.error(e)
      return { error: e }
    }
  }

  const defaultDb = config.default
  db.driver = db[defaultDb].driver

  // universal query method
  db.query = async (query, params, postprocess) => {
    if (!params || !Array.isArray(params)) {
      if (typeof params === 'function' && !postprocess) {
        // params argument was skipped but the postprocess argument was not
        // that means argument 2 is our postprocess function and params needs to be set to an empty array
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
    if (result) {
      logger.log('✅', (`Successfully connected to ${db[defaultDb].database}.`))
      return result
    } else {
      logger.error('Connection failed.')
    }
  }

  // universal end connection method
  db.endConnection = async () => {
    // end MariaDB connection
    if (db.mariadb.conn) {
      await db.mariadb.conn.release()
      await db.mariadb.pool.end()
      logger.log('🔚', 'MariaDB connection ended.')
    }
    // end MySQL connection
    if (db.mysql.conn) {
      await db.mysql.conn.release()
      await db.mysql.pool.end()
      logger.log('🔚', 'MySQL connection ended.')
    }
    // end PGlite connection
    if (db.pglite.db) {
      await db.pglite.db.close()
      logger.log('🔚', 'PGlite connection ended.')
    }
    // end PostgreSQL connection
    if (db.postgres.client) {
      await db.postgres.client.release()
      await db.postgres.pool.end()
      logger.log('🔚', 'PostgreSQL connection ended.')
    }
    // end SQLite connection
    if (db.sqlite.db) {
      await db.sqlite.db.close()
      logger.log('🔚', 'SQLite connection ended.')
    }
  }

  return db
}

// declare supported db modules. if any is not present in package.json, it will be set to null
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
