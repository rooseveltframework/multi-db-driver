## 1.3.0

- Breaking: Apps no longer fall back to guessed credentials when their configured credentials fail, unless the `NODE_ENV` environment variable is set to `development`. The new `guessCredentials` param controls this: set it to `true` to always guess, which restores the old behavior, `'development'` to guess only in development, which is the default for apps, or `false` to never guess, including from the CLI. A warning is now logged whenever a guessed set of credentials is the one that connects.
- Changed MariaDB, MySQL, and PostgreSQL queries to go through the connection pool rather than through one connection checked out of it at startup. This change should improve performance and stability.
- Fixed a bug that caused a single insert or update to be run as a transaction when its first param was `null`, a date, a buffer, or any other object, which ran the query once per param and threw on `null`. Params are now treated as transaction rows only when every one of them is an array or a plain object.
- Fixed a bug that caused a failed connection attempt to leave its pool open, which could keep the process from exiting.
- Fixed a bug that caused an idle PostgreSQL connection that dropped to crash the process, since the error it emits had no listener.
- Fixed the reason each connection attempt failed being thrown away. When no credentials connect, each attempt and its error are now logged.
- Fixed `loggerConfig.warn` being ignored, which prevented the CLI's `--suppress-logs` flag from suppressing warnings.
- Fixed database drivers being loaded from Multi-DB Driver's own dependencies rather than the app's whenever it has copies of its own, such as when it is linked to a clone or installed by a package manager that keeps each package's dependencies apart, such as pnpm. Drivers are now loaded from the app, found from the working directory the same way the config file is, with Multi-DB Driver's own copy as the fallback.
- Updated dependencies.

## 1.2.2

- Fixed a bug that caused the message logged on a successful database connection to print `[Function: bold]` instead of naming the user and database that were connected to.
- Fixed a bug that left `db.driver` and each `db.[database].driver` undefined instead of exposing the loaded driver module as documented.
- Simplified much of the code and removed some dependencies.

## 1.2.1

- Fixed a bug that prevented Multi-DB Driver from being loaded at all in contexts where `process.argv[1]` is undefined, such as the Node REPL or `node -e`.
- Reduced the size of the published npm package by excluding the test suite and development tooling from it.

## 1.2.0

- Fixed a bug that caused the `--create` CLI command to create MySQL and MariaDB users that could only connect from the database server's own host, which prevented the created user from logging in from anywhere else.
- Fixed a bug that caused the `--dump-schema` and `--dump-data` CLI commands to ignore the configured host and port, always attempting to dump from the default port on localhost.
- Fixed a bug that caused `testConnection` to report a successful connection when the connection test query had failed.
- Fixed a bug that prevented `~` from working in file paths. Paths beginning with `~` are now expanded to the current user's home directory in SQLite and PGlite database paths, schema paths, the `--file`, `--dump-schema`, and `--dump-data` CLI arguments, and the `MULTI_DB_DRIVER_CONFIG_LOCATION` environment variable.
- Improved the error reported when a configured database's driver is not installed: Multi-DB Driver now names the missing package and the command to install it, instead of reporting that the database is configured improperly. Queries against such a database report the same thing, rather than failing with an error about an undefined property.
- Updated dependencies.

## 1.1.3

- Fixed a bug that prevented errors from surfacing at times.
- Updated dependencies.

## 1.1.2

- Fixed a bug that prevented the most recent versions of MariaDB from working.
- Updated dependencies.

## 1.1.1

- Altered `configFinder.js` to look for both `.multi-db-config.json` and `.multi-db-driver-config.json` when searching for user defined config file.
- Updated dependencies.

## 1.1.0

- Changed all instances of `multi-db`, `MULTI_DB`, etc to `multi-db-driver`, `MULTI_DB_DRIVER`, etc for clarity.
- Updated various dependencies.

## 1.0.2

- Altered the logic of the `query` method to perform a transaction if `params` is supplied an array of objects or an array of arrays.
- Fixed a CLI text alignment issue.
- Updated dependencies.

## 1.0.1

- Fixed README typo regarding the npm package name.

## 1.0.0

- Initial commit.
