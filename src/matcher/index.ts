import {
  RouteRecordRaw,
  MatcherLocationRaw,
  MatcherLocation,
  isRouteName,
  RouteRecordName,
  _RouteRecordProps,
} from '../types'
import { createRouterError, ErrorTypes, MatcherError } from '../errors'
import { createRouteRecordMatcher, RouteRecordMatcher } from './pathMatcher'
import { RouteRecordNormalized } from './types'
import {
  PathParams,
  comparePathParserScore,
  PathParserOptions,
  _PathParserOptions,
} from './pathParserRanker'
import { warn } from '../warning'
import { assign, noop } from '../utils'

interface RouterMatcher {
  addRoute: (record: RouteRecordRaw, parent?: RouteRecordMatcher) => () => void
  removeRoute: {
    (matcher: RouteRecordMatcher): void
    (name: RouteRecordName): void
  }
  getRoutes: () => RouteRecordMatcher[]
  getRecordMatcher: (name: RouteRecordName) => RouteRecordMatcher | undefined

  /**
   * Resolves a location. Gives access to the route record that corresponds to the actual path as well as filling the corresponding params objects
   *
   * @param location - MatcherLocationRaw to resolve to a url
   * @param currentLocation - MatcherLocation of the current location
   */
  resolve: (
    location: MatcherLocationRaw,
    currentLocation: MatcherLocation
  ) => MatcherLocation
}

/**
 * 路由匹配器
 * Creates a Router Matcher.
 *
 * @internal
 * @param routes - array of initial routes 初始化的路由数组
 * @param globalOptions - global route options 全局路由配置项
 */
export function createRouterMatcher(
  routes: RouteRecordRaw[],
  globalOptions: PathParserOptions
): RouterMatcher {
  // normalized ordered array of matchers 经过标准化的匹配器
  const matchers: RouteRecordMatcher[] = []
  const matcherMap = new Map<RouteRecordName, RouteRecordMatcher>()
  globalOptions = mergeOptions(
    { strict: false, end: true, sensitive: false } as PathParserOptions,
    globalOptions
  )

  function getRecordMatcher(name: RouteRecordName) {
    return matcherMap.get(name)
  }

  // 添加路由. record: routers 的一项纪录
  function addRoute(
    record: RouteRecordRaw,
    parent?: RouteRecordMatcher,
    originalRecord?: RouteRecordMatcher
  ) {
    // 稍后用于删除名称
    // used later on to remove by name
    let isRootAdd = !originalRecord
    // 将该记录进行归一化, 也就是简单处理了一下， 几个属性给了默认值
    let mainNormalizedRecord = normalizeRouteRecord(record)
    // we might be the child of an alias 可能是一个别名的孩子
    mainNormalizedRecord.aliasOf = originalRecord && originalRecord.record
    // 将记录和全局的路由配置合并 是啥意思 ？
    const options: PathParserOptions = mergeOptions(globalOptions, record)
    // generate an array of records to correctly handle aliases 生成一个记录数组来正确处理别名
    const normalizedRecords: typeof mainNormalizedRecord[] = [
      mainNormalizedRecord,
    ]
    // record: routers 定义的 item 会执行到这
    if ('alias' in record) {
      const aliases =
        typeof record.alias === 'string' ? [record.alias] : record.alias!
      for (const alias of aliases) {
        // 如果有别名的话 需要一样推入到归一化的记录数组中去
        normalizedRecords.push(
          // TODO:
          assign({}, mainNormalizedRecord, {
            // this allows us to hold a copy of the `components` option
            // so that async components cache is hold on the original record
            components: originalRecord
              ? originalRecord.record.components
              : mainNormalizedRecord.components,
            path: alias,
            // we might be the child of an alias
            aliasOf: originalRecord
              ? originalRecord.record
              : mainNormalizedRecord,
            // the aliases are always of the same kind as the original since they
            // are defined on the same record
          }) as typeof mainNormalizedRecord
        )
      }
    }

    let matcher: RouteRecordMatcher
    let originalMatcher: RouteRecordMatcher | undefined

    // 如果没有别名，这里就只有一项
    for (const normalizedRecord of normalizedRecords) {
      let { path } = normalizedRecord
      //如果子项不是绝对子项，则为嵌套路由建立路径路线。仅在子路径不为空并且如果 父路径没有斜杠
      // Build up the path for nested routes if the child isn't an absolute
      // route. Only add the / delimiter if the child path isn't empty and if the
      // parent path doesn't have a trailing slash
      if (parent && path[0] !== '/') {
        let parentPath = parent.record.path
        let connectingSlash =
          parentPath[parentPath.length - 1] === '/' ? '' : '/'
        normalizedRecord.path =
          parent.record.path + (path && connectingSlash + path)
      }

      // 先创建对象，然后将其传递给子对象
      // create the object before hand so it can be passed to children
      matcher = createRouteRecordMatcher(normalizedRecord, parent, options)

      if (__DEV__ && parent && path[0] === '/')
        checkMissingParamsInAbsolutePath(matcher, parent)

      // 如果我们是别名，则必须告诉原始记录我们已经存在，因此我们可以被删除
      // if we are an alias we must tell the original record that we exist
      // so we can be removed
      if (originalRecord) {
        originalRecord.alias.push(matcher)
        if (__DEV__) {
          checkSameParams(originalRecord, matcher)
        }
      } else {
        // otherwise, the first record is the original and others are aliases
        originalMatcher = originalMatcher || matcher
        if (originalMatcher !== matcher) originalMatcher.alias.push(matcher)

        // 如果已命名过了，删除路由，并且仅用于最上面的记录（避免嵌套调用）
        // 因为原始记录是第一条记录，所以这是有效的
        // remove the route if named and only for the top record (avoid in nested calls)
        // this works because the original record is the first one
        if (isRootAdd && record.name && !isAliasRecord(matcher))
          removeRoute(record.name)
      }

      if ('children' in mainNormalizedRecord) {
        let children = mainNormalizedRecord.children
        for (let i = 0; i < children.length; i++) {
          addRoute(
            children[i],
            matcher,
            originalRecord && originalRecord.children[i]
          )
        }
      }

      // if there was no original record, then the first one was not an alias and all
      // other alias (if any) need to reference this record when adding children
      originalRecord = originalRecord || matcher

      insertMatcher(matcher)
    }

    return originalMatcher
      ? () => {
          // 有了别名之后，原来的匹配器需要删除
          // since other matchers are aliases, they should be removed by the original matcher
          removeRoute(originalMatcher!)
        }
      : noop
  }

  function removeRoute(matcherRef: RouteRecordName | RouteRecordMatcher) {
    if (isRouteName(matcherRef)) {
      const matcher = matcherMap.get(matcherRef)
      if (matcher) {
        // Map 和 数组都是用来存储匹配器的
        matcherMap.delete(matcherRef)
        matchers.splice(matchers.indexOf(matcher), 1)
        // 匹配器的 children 和 alias 依赖关系也需要删除
        matcher.children.forEach(removeRoute)
        matcher.alias.forEach(removeRoute)
      }
    } else {
      // 传入的是一个匹配器
      let index = matchers.indexOf(matcherRef)
      if (index > -1) {
        matchers.splice(index, 1)
        if (matcherRef.record.name) matcherMap.delete(matcherRef.record.name)
        matcherRef.children.forEach(removeRoute)
        matcherRef.alias.forEach(removeRoute)
      }
    }
  }

  function getRoutes() {
    return matchers
  }

  function insertMatcher(matcher: RouteRecordMatcher) {
    let i = 0
    // console.log('i is', { i })
    while (
      i < matchers.length &&
      comparePathParserScore(matcher, matchers[i]) >= 0
    )
      i++
    // console.log('END i is', { i })
    // while (i < matchers.length && matcher.score <= matchers[i].score) i++
    matchers.splice(i, 0, matcher)
    // 只会将原始匹配器加入到 map 中。 这里会通过 matcher 的 record 中是否含有 aliasOf 来判断是否是别名记录
    // only add the original record to the name map
    if (matcher.record.name && !isAliasRecord(matcher))
      matcherMap.set(matcher.record.name, matcher)
  }

  function resolve(
    location: Readonly<MatcherLocationRaw>,
    currentLocation: Readonly<MatcherLocation>
  ): MatcherLocation {
    let matcher: RouteRecordMatcher | undefined
    let params: PathParams = {}
    let path: MatcherLocation['path']
    let name: MatcherLocation['name']

    if ('name' in location && location.name) {
      matcher = matcherMap.get(location.name)

      if (!matcher)
        throw createRouterError<MatcherError>(ErrorTypes.MATCHER_NOT_FOUND, {
          location,
        })

      name = matcher.record.name
      params = assign(
        // paramsFromLocation is a new object
        paramsFromLocation(
          currentLocation.params,
          // only keep params that exist in the resolved location
          // TODO: only keep optional params coming from a parent record
          matcher.keys.filter(k => !k.optional).map(k => k.name)
        ),
        location.params
      )
      // throws if cannot be stringified
      path = matcher.stringify(params)
    } else if ('path' in location) {
      // no need to resolve the path with the matcher as it was provided
      // this also allows the user to control the encoding
      path = location.path

      if (__DEV__ && path[0] !== '/') {
        warn(
          `The Matcher cannot resolve relative paths but received "${path}". Unless you directly called \`matcher.resolve("${path}")\`, this is probably a bug in vue-router. Please open an issue at https://new-issue.vuejs.org/?repo=vuejs/vue-router-next.`
        )
      }

      matcher = matchers.find(m => m.re.test(path))
      // matcher should have a value after the loop

      if (matcher) {
        // TODO: dev warning of unused params if provided
        params = matcher.parse(path)!
        name = matcher.record.name
      }
      // location is a relative path
    } else {
      // match by name or path of current route
      matcher = currentLocation.name
        ? matcherMap.get(currentLocation.name)
        : matchers.find(m => m.re.test(currentLocation.path))
      if (!matcher)
        throw createRouterError<MatcherError>(ErrorTypes.MATCHER_NOT_FOUND, {
          location,
          currentLocation,
        })
      name = matcher.record.name
      // since we are navigating to the same location, we don't need to pick the
      // params like when `name` is provided
      params = assign({}, currentLocation.params, location.params)
      path = matcher.stringify(params)
    }

    const matched: MatcherLocation['matched'] = []
    let parentMatcher: RouteRecordMatcher | undefined = matcher
    while (parentMatcher) {
      // reversed order so parents are at the beginning

      matched.unshift(parentMatcher.record)
      parentMatcher = parentMatcher.parent
    }

    return {
      name,
      path,
      params,
      matched,
      meta: mergeMetaFields(matched),
    }
  }

  // add initial routes 添加初始路由
  routes.forEach(route => addRoute(route))

  return { addRoute, resolve, removeRoute, getRoutes, getRecordMatcher }
}

function paramsFromLocation(
  params: MatcherLocation['params'],
  keys: string[]
): MatcherLocation['params'] {
  let newParams = {} as MatcherLocation['params']

  for (let key of keys) {
    if (key in params) newParams[key] = params[key]
  }

  return newParams
}

/**
 * 归一化一个未加工的历史记录对象
 * Normalizes a RouteRecordRaw. Creates a copy
 *
 * @param record
 * @returns the normalized version
 */
export function normalizeRouteRecord(
  record: RouteRecordRaw
): RouteRecordNormalized {
  return {
    path: record.path,
    // 重定向地址 ？
    redirect: record.redirect,
    // router name
    name: record.name,
    meta: record.meta || {},
    // 别名
    aliasOf: undefined,
    // 只有这个守卫函数会被赋值，难道 routers 在声明时，只会传入 beforeEnter 这个钩子么
    beforeEnter: record.beforeEnter,
    props: normalizeRecordProps(record),
    children: record.children || [],
    instances: {},
    // 守卫函数数组一开始给的都是空的 ？
    leaveGuards: [],
    updateGuards: [],
    enterCallbacks: {},
    // TODO:
    components:
      'components' in record
        ? record.components || {}
        : { default: record.component! },
  }
}

/**
 * 将记录中的可选 props 规范化为始终是类似于以下内容的对象组件。也接受组件的布尔值。
 * Normalize the optional `props` in a record to always be an object similar to
 * components. Also accept a boolean for components.
 * @param record
 */
function normalizeRecordProps(
  record: RouteRecordRaw
): Record<string, _RouteRecordProps> {
  const propsObject = {} as Record<string, _RouteRecordProps>
  // props 在重定向记录中不存在，但是我们可以直接设置 false
  // props does not exist on redirect records but we can set false directly
  const props = (record as any).props || false
  // 纪录中 不存在 component ？
  if ('component' in record) {
    propsObject.default = props
  } else {
    //注意：我们还可以将函数应用于每个组件。需要用例的用户反馈
    // NOTE: we could also allow a function to be applied to every component.
    // Would need user feedback for use cases
    for (let name in record.components)
      propsObject[name] = typeof props === 'boolean' ? props : props[name]
  }

  return propsObject
}

/**
 * Checks if a record or any of its parent is an alias
 * FIXME: 这里的参数应该是 matcher
 * @param record
 */
function isAliasRecord(record: RouteRecordMatcher | undefined): boolean {
  while (record) {
    if (record.record.aliasOf) return true
    record = record.parent
  }

  return false
}

/**
 * Merge meta fields of an array of records
 *
 * @param matched array of matched records
 */
function mergeMetaFields(matched: MatcherLocation['matched']) {
  return matched.reduce(
    (meta, record) => assign(meta, record.meta),
    {} as MatcherLocation['meta']
  )
}

function mergeOptions<T>(defaults: T, partialOptions: Partial<T>): T {
  let options = {} as T
  for (let key in defaults) {
    options[key] =
      key in partialOptions ? partialOptions[key] : (defaults[key] as any)
  }

  return options
}

type ParamKey = RouteRecordMatcher['keys'][number]

function isSameParam(a: ParamKey, b: ParamKey): boolean {
  return (
    a.name === b.name &&
    a.optional === b.optional &&
    a.repeatable === b.repeatable
  )
}

function checkSameParams(a: RouteRecordMatcher, b: RouteRecordMatcher) {
  for (let key of a.keys) {
    if (!b.keys.find(isSameParam.bind(null, key)))
      return warn(
        `Alias "${b.record.path}" and the original record: "${a.record.path}" should have the exact same param named "${key.name}"`
      )
  }
  for (let key of b.keys) {
    if (!a.keys.find(isSameParam.bind(null, key)))
      return warn(
        `Alias "${b.record.path}" and the original record: "${a.record.path}" should have the exact same param named "${key.name}"`
      )
  }
}

function checkMissingParamsInAbsolutePath(
  record: RouteRecordMatcher,
  parent: RouteRecordMatcher
) {
  for (let key of parent.keys) {
    if (!record.keys.find(isSameParam.bind(null, key)))
      return warn(
        `Absolute path "${record.record.path}" should have the exact same param named "${key.name}" as its parent "${parent.record.path}".`
      )
  }
}

export { PathParserOptions, _PathParserOptions }
