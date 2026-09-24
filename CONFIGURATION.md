## Creating a Multi-DB Driver config

The following params are available when creating your Multi-DB Driver config file or passing params via the constructor:

### Required params

- `default` *[String]*: Which database your app will use by default.
  - Available options:
    - `mariadb`
    - `mysql`
    - `postgres`
    - `pglite`
    - `sqlite`

- `[mariadb|mysql|postgres|pglite|sqlite]` *[Object]*: Configs specific to each database.
  - `config` *[Object]*: Which config to attempt to connect to your database with by default. This object will be passed directly to the database driver, so the values should be set to whatever the database driver expects you to use to connect (e.g. host, username, password, database, other database configuration options).
    - It is recommended that you set the user to a less privileged user, typically meaning this user should be able to insert and delete data, but not create, alter, or drop tables.
    - If the credentials you specify do not exist, they can be created from the CLI scripts, which will use the `adminConfig` to connect in order to create the less privileged credentials.
  - `adminConfig` *[Object]*:  Same as `config` but you should configure it to use more privileged credentials, e.g. an account that is authorized to create tables, drop tables, administrate other users, etc. This config will be used for the CLI scripts for setup and teardown tasks. The regular, typically less-privileged config will be used for your app's business logic.

### Optional params

- `admin` *[Boolean]*: Force the use of `adminConfig` for your database instead of the regular `config`. Default: `false`.

- `guessCredentials` *[Boolean or String]*: Whether to try a series of common default credentials when the configured credentials cannot connect, then whichever of `config` or `adminConfig` was not tried first. Default: `'development'` for apps, `true` for the CLI scripts.
  - Available options:
    - `true`: Always guess.
    - `'development'`: Guess only when the `NODE_ENV` environment variable is set to `development`. An unset `NODE_ENV` counts as not development, so a deployment that forgets to set it does not guess.
    - `false`: Never guess.
  - Guessing is limited to development for apps by default because a deployed app whose own credentials fail would otherwise quietly connect as a superuser, possibly to a different database entirely.
  - Any other value is reported as an error and treated as `false`.
  - A warning is logged whenever a guessed set of credentials is the one that connects.

- `schema` *[String]*: Relative path to a file with what set of SQL statements you want to execute against your database when it is freshly created, if any. Default: `undefined`.

- `loggerConfig` *[Object]*: Options to suppress various kinds of logging.

Default:

```json
loggerConfig: {
  log: true, // regular logs
  warn: true, // warnings
  error: true, // logging errors
  verbose: true // verbose logging
}
```

- `questionMarkParamsForPostgres` *[Boolean]*: Automatically convert parameterized query placeholders from `?` to `$ + number` within Multi-DB Driver for PostgreSQL queries so you can use the `?` syntax in PostgreSQL queries, which isn't possible in native PostgreSQL queries. Default: `true`.
  - Only the placeholders are changed; the rest of the query is left exactly as written. A `?` inside a string, a quoted identifier, a comment, or a dollar-quoted body is left alone, as are the jsonb `?|` and `?&` operators.
  - A query that already uses `$1` style placeholders is left untouched, so you can write native PostgreSQL queries without turning this off.
  - The jsonb `?` operator on its own cannot be told apart from a placeholder, so a query that uses it needs `disableQuestionMarkParamsForPostgres` set in its query object.

- `mergeConfig` *[Boolean]*: Merge config values passed via constructor or environment variable with any `.multi-db-config.json` or `.multi-db-driver-config.json` file detected in your app's directory structure. Default: `true`.

### Example configs

Example for MariaDB:

````json
{
  "default": "mariadb",
  "mariadb": {
    "config": {
      "host": "localhost",
      "port": 3306,
      "user": "app_name",
      "password": "app_password",
      "database": "app_name"
    },
    "adminConfig": {
      "host": "localhost",
      "port": 3306,
      "user": "root",
      "password": "password",
      "database": "mariadb"
    },
    "schema": "db/schema.sql"
  }
}
````

Example for MySQL:

````json
{
  "default": "mysql",
  "mysql": {
    "config": {
      "host": "localhost",
      "port": 3306,
      "user": "app_name",
      "password": "app_password",
      "database": "app_name"
    },
    "adminConfig": {
      "host": "localhost",
      "port": 3306,
      "user": "root",
      "password": "password",
      "database": "mysql"
    },
    "schema": "db/schema.sql"
  }
}
````

Example for PostgreSQL:

```json
{
  "default": "postgres",
  "postgres": {
    "config": {
      "host": "localhost",
      "port": 5432,
      "user": "app_name",
      "password": "app_password",
      "database": "app_name"
    },
    "adminConfig": {
      "host": "localhost",
      "port": 5432,
      "username": "admin",
      "password": "admin_password",
      "database": "postgres"
    },
    "schema": "db/schema.sql"
  }
}
```

Example for PGlite:

```json
{
  "default": "pglite",
  "pglite": {
    "config": {
      "database": "pg-data"
    },
    "schema": "db/schema.sql"
  }
}
```

Example for SQLite:

````json
{
  "default": "sqlite",
  "sqlite": {
    "config": {
      "database": "db.sqlite"
    },
    "schema": "db/schema.sql"
  }
}

````

You could also create a single config that has configs for multiple databases or all of them if you like, but only one can be connected to per instance of Multi-DB Driver.

## Multi-DB Driver API

When you connect to a database using Multi-DB Driver like in the below example, the constructor will return a `db` object.

```javascript
const db = await require('multi-db-driver')(config)
```

This is the structure of the `db` object that Multi-DB Driver returns:

- `db.query(...)` *[Function]*: Universal database query method that works on all supported databases.
  - Arguments you can pass:
    - `query` *[String or Object]*:
      - When supplied a string as an argument, it will execute the query string against the default driver.
      - When supplied an object as an argument, you can supply the following keys:
        - `default`: A query string to execute against whichever database is the default.
        - `mariadb`: A query string that will only execute against MariaDB databases.
        - `mysql`: A query string that will only execute against MySQL databases.
        - `postgres`: A query string that will only execute against PostgreSQL databases.
        - `pglite`: A query string that will only execute against SQLite databases.
        - `sqlite`: A query string that will only execute against SQLite databases.
        - `disableQuestionMarkParamsForPostgres`: Set to true to prevent the query from attempting to normalize parameterized query placeholders from `?` syntax to `$1 $2 $3 etc` syntax for PostgreSQL and PGlite queries.
    - `params` *[Array]*: Optional array of parameters to supply values to the query.
      - When supplied an array of strings, it will perform a normal query.
      - When supplied an array of objects or an array of arrays, it will perform a transaction.
    - `next(db, result)` *[Function]*: Optional callback function to execute when the query is finished.
      - Arguments provided:
        - `db` *[String]*: Which database the query was executed against.
        - `result` *[Object]*: The resulting object from the query the database driver gives you.

- `db.config` *[Object]*: Object representing the config loaded.

- `db.driver` *[Object]*: The object the default database driver module returns in case you need to interact with it directly.

- `db.drivers` *[Object]*: Object collection of all the driver modules currently loaded.

- `db.mariadb` *[Object]*: MariaDB-specific APIs.
  - `driver` *[Object]*: The object the `mariadb` module returns in case you need to interact with it directly.
  - `pool` *[Object]*: The pool instance returned by [mariadb](https://github.com/mariadb-corporation/mariadb-connector-nodejs)'s createPool method once instantiated.
  - `conn` *[Object]*: The connection instance returned by the pool instance's getConnection method once instantiated.
  - `username` *[String]*: Username of the current active connection, if a connection is active.
  - `database` *[String]*: Which database the currently active connection is connected to, if a connection is active.
  - `query(queryString)` *[Function]*: Function that takes a query string and executes it against the `mariadb` driver.

- `db.mysql` *[Object]*: MySQL-specific APIs.
  - `driver` *[Object]*: The object the `mysql2` module returns in case you need to interact with it directly.
  - `pool` *[Object]*: The pool instance returned by [mysql2's createPool](https://github.com/sidorares/node-mysql2#using-connection-pools) method once instantiated.
  - `conn` *[Object]*: The connection instance returned by the pool instance's getConnection method once instantiated.
  - `username` *[String]*: Username of the current active connection, if a connection is active.
  - `database` *[String]*: Which database the currently active connection is connected to, if a connection is active.
  - `query(queryString)` *[Function]*: Function that takes a query string and executes it against the `mysql2` driver.

- `db.postgres` *[Object]*: PostgreSQL-specific APIs.
  - `driver` *[Object]*: The object the `pg` module returns in case you need to interact with it directly.
  - `pool` *[Object]*: The instance of [pg.Pool](https://node-postgres.com/apis/pool) created by Multi-DB Driver once instantiated.
  - `client` *[Object]*: The instance of [pg.Client](https://node-postgres.com/apis/client) created by Multi-DB Driver once instantiated.
  - `username` *[String]*: Username of the current active connection, if a connection is active.
  - `database` *[String]*: Which database the currently active connection is connected to, if a connection is active.
  - `query(queryString)` *[Function]*: Function that takes a query string and executes it against the `pg` driver.

- `db.pglite` *[Object]*: PGlite-specific APIs.
  - `driver` *[Object]*: The object the `@electric-sql/pglite` module returns in case you need to interact with it directly.
  - `db` *[Object]*: The database instance returned by [@electric-sql/pglite's Database constructor](https://github.com/electric-sql/pglite?tab=readme-ov-file#main-constructor) once instantiated.
  - `query(queryString)` *[Function]*: Function that takes a query string and executes it against the `@electric-sql/pglite` driver.

- `db.sqlite` *[Object]*: SQLite-specific APIs.
  - `driver` *[Object]*: The object the `better-sqlite3` module returns in case you need to interact with it directly.
  - `db` *[Object]*: The database instance returned by [better-sqlite3's Database constructor](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#new-databasepath-options) once instantiated.
  - `query(queryString)` *[Function]*: Function that takes a query string and executes it against the `better-sqlite3` driver.
