// rewrites ? placeholders to the $1 $2 $3 style that postgres and pglite want
//
// this scans the query rather than parsing it, so it never needs to understand the sql itself and never changes anything but the placeholders. it only has to know where a ? is a placeholder and where it is part of something else: a ? inside a string, a quoted identifier, a comment, or a dollar-quoted body is left alone, as are the jsonb ?| and ?& operators
//
// a query that already contains a $1 style placeholder is returned untouched, because it is already written for postgres and rewriting any ? in it as well would number the placeholders wrongly
//
// the jsonb ? operator on its own cannot be told apart from a placeholder, so a query that uses it needs disableQuestionMarkParamsForPostgres
module.exports = (query) => {
  const n = query.length
  const isWordChar = char => /\w/.test(char || '')
  let out = ''
  let count = 0
  let i = 0

  // the index just past a quoted run starting at i, where a doubled quote character is an escaped one. backslash escapes are honored too when the run is an E'' string
  function endOfQuoted (quote, backslashes) {
    let j = i + 1
    while (j < n) {
      if (backslashes && query[j] === '\\') j += 2
      else if (query[j] === quote && query[j + 1] === quote) j += 2
      else if (query[j] === quote) return j + 1
      else j++
    }
    return n
  }

  // the index just past a block comment starting at i. block comments nest in postgres
  function endOfBlockComment () {
    let depth = 0
    let j = i
    do {
      if (query[j] === '/' && query[j + 1] === '*') {
        depth++
        j += 2
      } else if (query[j] === '*' && query[j + 1] === '/') {
        depth--
        j += 2
      } else j++
    } while (depth > 0 && j < n)
    return j
  }

  // the index just past the first occurrence of end at or after from
  function endOf (end, from) {
    const stop = query.indexOf(end, from)
    return stop === -1 ? n : stop + end.length
  }

  while (i < n) {
    const char = query[i]
    const next = query[i + 1]
    let to = i + 1 // how far to copy unchanged, unless this character turns out to be a placeholder

    if (char === '\'') {
      const escapeString = /[eE]/.test(query[i - 1] || '') && !isWordChar(query[i - 2])
      to = endOfQuoted('\'', escapeString)
    } else if (char === '"') {
      to = endOfQuoted('"', false)
    } else if (char === '-' && next === '-') {
      to = endOf('\n', i)
    } else if (char === '/' && next === '*') {
      to = endOfBlockComment()
    } else if (char === '$' && !isWordChar(query[i - 1])) {
      if (/[0-9]/.test(next || '')) return query // already written with $1 style placeholders
      const tag = query.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (tag) to = endOf(tag[0], i + tag[0].length) // a dollar-quoted body such as $$ ... $$ or $fn$ ... $fn$
    } else if (char === '?') {
      if (next === '|' || next === '&') to = i + 2 // the jsonb ?| and ?& operators
      else {
        out += '$' + (++count)
        i++
        continue
      }
    }

    out += query.slice(i, to)
    i = to
  }

  return out
}
