## Install

First mark your desired database drivers as dependencies in your app.

List of currently-supported database drivers:

- [mariadb](https://www.npmjs.com/package/mariadb) for MariaDB.
- [mysql2](https://www.npmjs.com/package/mysql2) for MySQL.
- [pg](https://www.npmjs.com/package/pg) for PostgreSQL.
- [pglite](https://www.npmjs.com/package/@electric-sql/pglite) for PGlite.
- [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) for SQLite.

Then mark the `multi-db-driver` npm package as a dependency in your app as well. Multi-DB Driver is generally designed to work with recent versions of each supported database driver. Older versions and newer versions are likely to work too, but we do not test every combination. If you find a version that doesn't work, please open an issue.

Then you can configure Multi-DB Driver and connect to your database.

## Connect to a database using Multi-DB Driver

```javascript
const db = await require('multi-db-driver')(config)
```

If you do not supply a `config` object in the constructor, Multi-DB Driver will attempt to load your config from either a `.multi-db-config.json` or `.multi-db-driver-config.json` file that should most commonly be placed in the root directory of your app.

Multi-DB Driver will look for that file in up to 3 directories above where the Multi-DB Driver module is located (e.g. looking at parent directories starting with node_modules). You can change this behavior by setting the `MULTI_DB_DRIVER_CONFIG_FILE_SEARCH_ATTEMPTS` environment variable to a number other than 3. The default value of 3 will in most circumstances include the root directory of your app as one of the locations that will be searched for your Multi-DB Driver config, which is why it's the default value.

If you want to set a location for the config file manually, then set the `MULTI_DB_DRIVER_CONFIG_LOCATION` environment variable to the absolute path on your filesystem to where your config is.

It is recommended that you add `.multi-db-config.json` and/or `.multi-db-driver-config.json` to your .gitignore as well because they will typically contain database credentials.

See "Configuration" for information about how to set up a Multi-DB Driver config.

## Performing database queries

The below examples show how to use Multi-DB Driver to query your database(s) from the simplest usage to the most complex, demonstrating how this module focuses on adding complexity only when needed as a progressive enhancement atop simpler, more concise syntax.

### Example of one universal query that works with any database you set in your config

```javascript
const simpleQuery = await db.query('select * from some_table')
```

This usage is basically as concise as any standalone database driver would be, except it will work with any database that uses the same SQL syntax for this specific query and similar basic ones.

### Universal query but with parameters

```javascript
const noNormalizingNeeded = await db.query('select * from some_table where something = ?', ['some value'])
```

The second argument is optional if you don't need params.

### Universal query with parameters and a callback function for post-processing

```javascript
const normalizedDataUniversalQuery = await db.query('select * from some_table where something = ?', ['some value'], function (db, result) {
  switch (db) {
    case 'mysql':
      // do stuff if it was a mysql query
      return result
    default:
      // do stuff if it was a query to any other kind of database
      return result
  }
})
```

The third argument is optional if you don't need a post-processing function.

The post-processing function is useful if you need to call out specific post-processing behaviors for certain databases.

### Default query with special query for a specific database

```javascript
const normalizedDataMultipleQueries = await db.query(

// queries object
{
  default: 'select * from some_table where something = ?',
  mysql: 'some mysql-specific version of the query where something = ?'
},

// values array
['some value'],

// postprocess function
function (db, result) {
  switch (db) {
    case 'mysql':
      // do stuff if it was a mysql query
      return result
    default:
      // do stuff if it was any other kind of query
      return result
  }
})
```

This supplies an object instead of a string to the query argument.

It also combines all the other above features too, showing a maximally featureful and flexible version of the query method.

By default Multi-DB Driver will rewrite the query under the hood to use `$1` instead of `?` for queries being executed against PostgreSQL and PGlite. Only the placeholders are changed, and a query already written with `$1` style placeholders is left untouched. You can disable this behavior by setting `questionMarkParamsForPostgres` to `false` in your Multi-DB Driver config, or by setting `disableQuestionMarkParamsForPostgres` to `true` at the query level in the query object.

## CLI scripts

This module also comes with a `cli.js` file to automate common database setup and teardown tasks. It will load your Multi-DB Driver config and connect to the database using the `adminConfig` to perform these tasks.

The `cli.js` file supports the following commands:

- `cli.js --create`: Creates the user and database specified in your config if it does not already exist.
- `cli.js --destroy`: Drops the user and database specified in your config.
- `cli.js --file file.sql`: Executes the SQL statements in the specified SQL file. Will attempt to do so using the regular less privileged config by default and will escalate to the admin config only if the less privileged config is unable to connect.
- `cli.js --dump-schema path/to/schema.sql`: Dumps the connected database's schema to specified SQL file path. Will create file in specified path if it does not already exist.
- `cli.js --dump-data path/to/schema.sql`: Dumps the connected database's schema and data to specified SQL file path. Will create file in specified path if it does not already exist.

For the dump commands to work, you will need to ensure `pg_dump`, `mysqldump`, and `sqlite3` are in your PATH.

### Options

- Skip the prompts with `--yes`.
- Suppress logs and warnings with `--suppress-logs`.
- Suppress errors with `--suppress-errors`.
- Enable verbose logging with `--enable-verbose`.

### Integrating the CLI scripts into your app

It is recommended that you create npm scripts in your app's package.json file to run those commands. Example usage of those scripts if you create them would look something like this:

- `npm run create-db`: Executes `node [...]/cli.js --create`.
- `npm run destroy-db`: Executes `node [...]/cli.js --destroy`.
- `npm run db-file -- file.sql`: Executes `node [...]/cli.js --file file.sql`.
- `npm run db-schema-dump -- path/to/schema.sql`: Executes `node [...]/cli.js --dump-schema path/to/schema.sql`.
- `npm run db-data-dump -- path/to/schema.sql`: Executes `node [...]/cli.js --dump-data path/to/schema.sql`.

Replace the `[...]` part in the above examples with the path to where your copy of this module resides, e.g. in `node_modules`, lib, `git_modules`, or wherever it happens to be in your app.

## Writing schemas in a portable way

Here is an example schema that is fully portable across all supported databases:

```sql
create table if not exists parent_t (
  id integer primary key,
  name varchar(64) not null unique,
  note text,
  amount double precision,
  big bigint,
  started date,
  created timestamp default current_timestamp,
  qty integer default 0 check (qty >= 0)
);

create table if not exists child_t (
  id integer primary key,
  parent_id integer,
  foreign key (parent_id) references parent_t(id)
);

create index idx_child_parent on child_t (parent_id);
```

Schema SQL that is portable is roughly:

- `create table if not exists`
- lowercase, unquoted, non-reserved identifiers
- `integer`, `bigint`, `varchar(n)`, `text`, `double precision`, `date`, `timestamp`
- `primary key` on an application-supplied value
- `not null`, `unique`, `default`, and `check` constraints
- `foreign key (...) references ...` written as a table-level constraint
- `default current_timestamp`
- plain `create index` with no `where` clause

That is enough to express most of a typical schema, but just like in the above examples with writing universal queries, sometimes you will not be able to write a universal schema using fully portable syntax and you will need to rely on specific database features. Features that are specific to databases include auto-increment, `text` columns larger than 64KB on MySQL and MariaDB, JSON, case sensitivity, etc. As such, **you are much more likely to need database-specific schemas than you are to need database-specific queries**.

### Making portable schemas when you need database-specific features

Either:

**Hand-write per-database schema files.** Multi-DB Driver configures `schema` per database, so the parts that cannot be expressed portably can differ per engine while the rest of your application stays the same. This is the simplest answer for the auto-increment problem.

**Or generate them automatically by writing your schema in a neutral format.** If you want a single source of truth, define the schema in a neutral form and emit the dialect-specific schema from it.

Here is an example in [Knex](https://knexjs.org/guide/schema-builder.html):

```javascript
const fs = require('fs')

const define = k => k.schema.createTable('widgets', t => {
  t.increments('id')
  t.string('name', 64).notNullable().unique()
  t.text('note')
  t.integer('qty').defaultTo(0)
  t.timestamp('created').defaultTo(k.fn.now())
})

for (const [client, file] of [['pg', 'postgres.sql'], ['mysql2', 'mysql.sql'], ['better-sqlite3', 'sqlite.sql']]) {
  const k = require('knex')({ client, useNullAsDefault: true })
  fs.writeFileSync(file, define(k).toString() + ';\n') // knex leaves off the final semicolon
  k.destroy()
}
```

That writes three schema files, which between them cover all five databases: use `postgres.sql` for PostgreSQL and PGlite, and `mysql.sql` for both MySQL and MariaDB.

`postgres.sql`:

```sql
create table "widgets" ("id" serial primary key, "name" varchar(64) not null, "note" text, "qty" integer default '0', "created" timestamptz default CURRENT_TIMESTAMP);
alter table "widgets" add constraint "widgets_name_unique" unique ("name");
```

`mysql.sql`:

```sql
create table `widgets` (`id` int unsigned not null auto_increment primary key, `name` varchar(64) not null, `note` text, `qty` int default '0', `created` timestamp default CURRENT_TIMESTAMP);
alter table `widgets` add unique `widgets_name_unique`(`name`);
```

`sqlite.sql`:

```sql
create table `widgets` (`id` integer not null primary key autoincrement, `name` varchar(64) not null, `note` text, `qty` integer default '0', `created` datetime default CURRENT_TIMESTAMP);
create unique index `widgets_name_unique` on `widgets` (`name`);
```

Other tools in the same family include [Prisma](https://www.prisma.io/docs/orm/prisma-schema), [Atlas](https://atlasgo.io/), [Liquibase](https://www.liquibase.com/), and the schema builders in [Sequelize](https://sequelize.org/) and [TypeORM](https://typeorm.io/). You do not have to adopt the whole tool: Knex above is only being used to generate SQL, which you can then hand to Multi-DB Driver as a per-database `schema` file.
