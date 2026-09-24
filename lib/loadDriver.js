// loads a database driver from the app that is using multi-db-driver, falling back to multi-db-driver's own copy
//
// the drivers are the app's to install, so the app's copy is the one that should run. a plain require from here searches multi-db-driver's own node_modules first, which in an ordinary install has no drivers in it, but which does whenever multi-db-driver is linked to a clone, whose development dependencies include every driver, or is installed by a package manager that keeps each package's dependencies apart, such as pnpm. the working directory is treated as the app's, which is also where the config file is looked for
//
// returns a promise, because a driver published only as an es module has to be imported rather than required
const path = require('path')
const { createRequire } = require('module')
const { pathToFileURL } = require('url')

module.exports = async name => {
  const appRequire = createRequire(path.resolve(process.cwd(), 'package.json'))
  try {
    return appRequire(name)
  } catch (err) {
    if (err.code === 'ERR_REQUIRE_ESM') return import(pathToFileURL(appRequire.resolve(name)).href)
    // only the driver itself being absent from the app falls back. one the app has that fails to load is reported as it is rather than covered up by a different copy
    if (err.code !== 'MODULE_NOT_FOUND' || !err.message.includes(`'${name}'`)) throw err
  }
  try {
    return require(name)
  } catch (err) {
    if (err.code === 'ERR_REQUIRE_ESM') return import(name)
    throw err
  }
}
