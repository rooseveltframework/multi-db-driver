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
