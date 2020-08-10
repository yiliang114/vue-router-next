import { RouterHistory } from './common'
import { createWebHistory } from './html5'
import { warn } from '../warning'

/**
 * Creates a hash history.
 *
 * @param base - optional base to provide. Defaults to `location.pathname` or
 * `/` if at root. If there is a `base` tag in the `head`, its value will be
 * **ignored**.
 *
 * @example
 * ```js
 * // at https://example.com/folder
 * createWebHashHistory() // gives a url of `https://example.com/folder#`
 * createWebHashHistory('/folder/') // gives a url of `https://example.com/folder/#`
 * // if the `#` is provided in the base, it won't be added by `createWebHashHistory`
 * createWebHashHistory('/folder/#/app/') // gives a url of `https://example.com/folder/#/app/`
 * // you should avoid doing this because it changes the original url and breaks copying urls
 * createWebHashHistory('/other-folder/') // gives a url of `https://example.com/other-folder/#`
 *
 * // at file:///usr/etc/folder/index.html
 * // for locations with no `host`, the base is ignored
 * createWebHashHistory('/iAmIgnored') // gives a url of `file:///usr/etc/folder/index.html#`
 * ```
 */
export function createWebHashHistory(base?: string): RouterHistory {
  //确保此实现在编码方面特别适合IE11
  //对于`file：//`，直接使用路径名并忽略基数
  //location.pathname甚至在根目录下也包含一个初始`/`：https://example.com
  // Make sure this implementation is fine in terms of encoding, specially for IE11
  // for `file://`, directly use the pathname and ignore the base
  // location.pathname contains an initial `/` even at the root: `https://example.com`
  base = location.host ? base || location.pathname : location.pathname
  // allow the user to provide a `#` in the middle: `/base/#/app`
  if (base.indexOf('#') < 0) base += '#'

  if (__DEV__ && !base.endsWith('#/') && !base.endsWith('#')) {
    warn(
      `A hash base must end with a "#":\n"${base}" should be "${base.replace(
        /#.*$/,
        '#'
      )}".`
    )
  }
  // base 中携带 # 来创建一个 history 模式
  return createWebHistory(base)
}
