const fs = require('fs')
const multiDb = require('../../multi-db-driver')
const path = require('path')

module.exports = async (db, droppedDatabase) => {
  const data = JSON.parse(fs.readFileSync(path.normalize('.multi-db-driver-config.json')))

  // override host and port in config
  fs.writeFileSync(path.normalize('.multi-db-driver-config.json'), JSON.stringify(data, null, 2))
  let multiDbConnection
  let mysqlAndMariaDbDatabases
  if (db === 'mariadb' || db === 'mysql') {
    multiDbConnection = await multiDb({
      admin: true,
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })
    mysqlAndMariaDbDatabases = await multiDbConnection.query('show databases')
  } else {
    multiDbConnection = await multiDb({
      loggerConfig: {
        log: false,
        error: false,
        verbose: false
      }
    })
  }
  return new Promise((resolve, reject) => {
    switch (db) {
      case 'mariadb': {
        let mariadbDatabaseNotDestroyed
        for (let i = 0; i < mysqlAndMariaDbDatabases.rows.length; i++) {
          if (mysqlAndMariaDbDatabases.rows[i].Database === droppedDatabase) {
            mariadbDatabaseNotDestroyed = true
            break
          }
        }
        if (mariadbDatabaseNotDestroyed) resolve('not destroyed')
        else resolve('destroyed')
        break
      }
      case 'mysql': {
        let mysqlDatabaseNotDestroyed
        for (let i = 0; i < mysqlAndMariaDbDatabases.rows[0].length; i++) {
          if (mysqlAndMariaDbDatabases.rows[0][i].Database === droppedDatabase) {
            mysqlDatabaseNotDestroyed = true
            break
          }
        }
        if (mysqlDatabaseNotDestroyed) resolve('not destroyed')
        else resolve('destroyed')
        break
      }
      case 'pglite': {
        if (multiDbConnection.pglite.database === droppedDatabase) {
          resolve('not destroyed')
        } else {
          resolve('destroyed')
        }
        break
      }
      case 'postgres': {
        if (multiDbConnection.postgres.database === droppedDatabase) resolve('not destroyed')
        else resolve('destroyed')
        break
      }
      case 'sqlite': {
        if (multiDbConnection.sqlite.database === droppedDatabase) {
          resolve('not destroyed')
        } else {
          resolve('destroyed')
        }
        break
      }
    }
    multiDbConnection.endConnection()
  })
}
