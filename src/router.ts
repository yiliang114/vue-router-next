import {
  RouteLocationNormalized,
  RouteRecordRaw,
  RouteLocationRaw,
  PostNavigationGuard,
  START_LOCATION_NORMALIZED,
  Lazy,
  RouteLocationNormalizedLoaded,
  RouteLocation,
  RouteRecordName,
  isRouteName,
  NavigationGuardWithThis,
  RouteLocationOptions,
  MatcherLocationRaw,
} from './types'
import { RouterHistory, HistoryState } from './history/common'
import {
  ScrollPosition,
  getSavedScrollPosition,
  getScrollKey,
  saveScrollPosition,
  computeScrollPosition,
  scrollToPosition,
  _ScrollPositionNormalized,
} from './scrollBehavior'
import { createRouterMatcher, PathParserOptions } from './matcher'
import {
  createRouterError,
  ErrorTypes,
  NavigationFailure,
  NavigationRedirectError,
  isNavigationFailure,
} from './errors'
import { applyToParams, isBrowser, assign, noop } from './utils'
import { useCallbacks } from './utils/callbacks'
import { encodeParam, decode, encodeHash } from './encoding'
import {
  normalizeQuery,
  parseQuery as originalParseQuery,
  stringifyQuery as originalStringifyQuery,
  LocationQuery,
} from './query'
import {
  shallowRef,
  Ref,
  nextTick,
  App,
  ComputedRef,
  reactive,
  unref,
  computed,
} from 'vue'
import { RouteRecord, RouteRecordNormalized } from './matcher/types'
import { parseURL, stringifyURL, isSameRouteLocation } from './location'
import { extractComponentsGuards, guardToPromiseFn } from './navigationGuards'
import { warn } from './warning'
import { RouterLink } from './RouterLink'
import { RouterView } from './RouterView'
import { routerKey, routeLocationKey } from './injectionSymbols'

/**
 * Internal type to define an ErrorHandler
 * @internal
 */
export type ErrorHandler = (error: any) => any
// resolve, reject arguments of Promise constructor
type OnReadyCallback = [() => void, (reason?: any) => void]

type Awaitable<T> = T | Promise<T>

export interface ScrollBehavior {
  (
    to: RouteLocationNormalized,
    from: RouteLocationNormalizedLoaded,
    savedPosition: _ScrollPositionNormalized | null
  ): Awaitable<ScrollPosition | false | void>
}

export interface RouterOptions extends PathParserOptions {
  /**
   * History implementation used by the router. Most web applications should use
   * `createWebHistory` but it requires the server to be properly configured.
   * You can also use a _hash_ based history with `createWebHashHistory` that
   * does not require any configuration on the server but isn't handled at all
   * by search engines and does poorly on SEO.
   *
   * @example
   * ```js
   * createRouter({
   *   history: createWebHistory(),
   *   // other options...
   * })
   * ```
   */
  history: RouterHistory
  /**
   * Initial list of routes that should be added to the router.
   */
  routes: RouteRecordRaw[]
  /**
   * Function to control scrolling when navigating between pages.
   */
  scrollBehavior?: ScrollBehavior
  /**
   * Custom implementation to parse a query.
   *
   * @example
   * Let's say you want to use the package {@link https://github.com/ljharb/qs | `qs`}
   * to parse queries, you would need to provide both `parseQuery` and
   * {@link RouterOptions.stringifyQuery | `stringifyQuery`}:
   * ```js
   * import qs from 'qs'
   *
   * createRouter({
   *   // other options...
   *   parse: qs.parse,
   *   stringifyQuery: qs.stringify,
   * })
   * ```
   */
  parseQuery?: typeof originalParseQuery
  /**
   * {@link RouterOptions.parseQuery | `parseQuery`} counterpart to handle query parsing.
   */
  stringifyQuery?: typeof originalStringifyQuery
  /**
   * Default class applied to active {@link RouterLink}. If none is provided,
   * `router-link-active` will be applied.
   */
  linkActiveClass?: string
  /**
   * Default class applied to exact active {@link RouterLink}. If none is provided,
   * `router-link-exact-active` will be applied.
   */
  linkExactActiveClass?: string
  /**
   * Default class applied to non active {@link RouterLink}. If none is provided,
   * `router-link-inactive` will be applied.
   */
  // linkInactiveClass?: string
}

export interface Router {
  /**
   * @internal
   */
  // readonly history: RouterHistory
  readonly currentRoute: Ref<RouteLocationNormalizedLoaded>
  readonly options: RouterOptions

  addRoute(parentName: RouteRecordName, route: RouteRecordRaw): () => void
  addRoute(route: RouteRecordRaw): () => void
  removeRoute(name: RouteRecordName): void
  hasRoute(name: RouteRecordName): boolean
  getRoutes(): RouteRecord[]

  resolve(to: RouteLocationRaw): RouteLocation & { href: string }

  push(to: RouteLocationRaw): Promise<NavigationFailure | void | undefined>
  replace(to: RouteLocationRaw): Promise<NavigationFailure | void | undefined>
  back(): Promise<NavigationFailure | void | undefined>
  forward(): Promise<NavigationFailure | void | undefined>
  go(delta: number): Promise<NavigationFailure | void | undefined>

  beforeEach(guard: NavigationGuardWithThis<undefined>): () => void
  beforeResolve(guard: NavigationGuardWithThis<undefined>): () => void
  afterEach(guard: PostNavigationGuard): () => void

  onError(handler: ErrorHandler): () => void
  isReady(): Promise<void>

  install(app: App): void
}

/**
 * 创建可在 Vue 应用程序上使用的 Router实例
 * Create a Router instance that can be used on a Vue app.
 *
 * @param options - {@link RouterOptions}
 */
export function createRouter(options: RouterOptions): Router {
  // 创建一个匹配器
  const matcher = createRouterMatcher(options.routes, options)
  // 一般来说开发者不会传 parseQuery 这个配置。这是一个将 query 转化为一个对象的函数，可被自定义传入
  let parseQuery = options.parseQuery || originalParseQuery
  // 类似上面，将 query 对象转化为 string query 形式
  let stringifyQuery = options.stringifyQuery || originalStringifyQuery
  let { scrollBehavior } = options
  // 传入的 history 是显示调用 createXXXHistory 创建的。
  let routerHistory = options.history

  // 闭包做了一个私有数组，用来保存回调函数
  const beforeGuards = useCallbacks<NavigationGuardWithThis<undefined>>()
  const beforeResolveGuards = useCallbacks<NavigationGuardWithThis<undefined>>()
  const afterGuards = useCallbacks<PostNavigationGuard>()
  // 浅层观察 ？
  const currentRoute = shallowRef<RouteLocationNormalizedLoaded>(
    START_LOCATION_NORMALIZED
  )
  // 初始状态的路由
  let pendingLocation: RouteLocation = START_LOCATION_NORMALIZED

  // 这里应该是用户指定了滚动行为，所以 history.scrollRestoration 肯定需要修改，不能是 auto
  // leave the scrollRestoration if no scrollBehavior is provided
  if (isBrowser && scrollBehavior && 'scrollRestoration' in history) {
    // auto: 将恢复用户已滚动到的页面上的位置。
    // manual: 未还原页上的位置。用户必须手动滚动到该位置。
    history.scrollRestoration = 'manual'
  }

  // 此处获取的是一个空的对象， applyToParams 第二个参数都没有给
  const normalizeParams = applyToParams.bind(
    null,
    paramValue => '' + paramValue
  )
  const encodeParams = applyToParams.bind(null, encodeParam)
  const decodeParams = applyToParams.bind(null, decode)

  function addRoute(
    parentOrRoute: RouteRecordName | RouteRecordRaw,
    route?: RouteRecordRaw
  ) {
    let parent: Parameters<typeof matcher['addRoute']>[1] | undefined
    // 记录
    let record: RouteRecordRaw
    if (isRouteName(parentOrRoute)) {
      parent = matcher.getRecordMatcher(parentOrRoute)
      record = route!
    } else {
      record = parentOrRoute
    }

    // TODO: 这里只传了一个参数怎么办？
    return matcher.addRoute(record, parent)
  }

  function removeRoute(name: RouteRecordName) {
    let recordMatcher = matcher.getRecordMatcher(name)
    if (recordMatcher) {
      matcher.removeRoute(recordMatcher)
    } else if (__DEV__) {
      warn(`Cannot remove non-existent route "${String(name)}"`)
    }
  }

  function getRoutes() {
    return matcher.getRoutes().map(routeMatcher => routeMatcher.record)
  }

  function hasRoute(name: RouteRecordName): boolean {
    return !!matcher.getRecordMatcher(name)
  }

  function resolve(
    rawLocation: Readonly<RouteLocationRaw>,
    currentLocation?: RouteLocationNormalizedLoaded
  ): RouteLocation & { href: string } {
    // const objectLocation = routerLocationAsObject(rawLocation)
    // we create a copy to modify it later
    currentLocation = { ...(currentLocation || currentRoute.value) }
    if (typeof rawLocation === 'string') {
      let locationNormalized = parseURL(
        parseQuery,
        rawLocation,
        currentLocation.path
      )
      let matchedRoute = matcher.resolve(
        { path: locationNormalized.path },
        currentLocation
      )

      let href = routerHistory.createHref(locationNormalized.fullPath)
      if (__DEV__) {
        if (href.startsWith('//'))
          warn(
            `Location "${rawLocation}" resolved to "${href}". A resolved location cannot start with multiple slashes.`
          )
        else if (!matchedRoute.matched.length) {
          warn(`No match found for location with path "${rawLocation}"`)
        }
      }

      // locationNormalized is always a new object
      return assign(locationNormalized, matchedRoute, {
        params: decodeParams(matchedRoute.params),
        redirectedFrom: undefined,
        href,
      })
    }

    let matcherLocation: MatcherLocationRaw

    // path could be relative in object as well
    if ('path' in rawLocation) {
      if (
        __DEV__ &&
        'params' in rawLocation &&
        !('name' in rawLocation) &&
        Object.keys((rawLocation as any).params).length
      ) {
        warn(
          `Path "${
            (rawLocation as any).path
          }" was passed with params but they will be ignored. Use a named route alongside params instead.`
        )
      }
      matcherLocation = assign({}, rawLocation, {
        path: parseURL(parseQuery, rawLocation.path, currentLocation.path).path,
      })
    } else {
      // pass encoded values to the matcher so it can produce encoded path and fullPath
      matcherLocation = assign({}, rawLocation, {
        params: encodeParams(rawLocation.params),
      })
      // current location params are decoded, we need to encode them in case the
      // matcher merges the params
      currentLocation.params = encodeParams(currentLocation.params)
    }

    let matchedRoute = matcher.resolve(matcherLocation, currentLocation)
    const hash = encodeHash(rawLocation.hash || '')

    if (__DEV__ && hash && !hash.startsWith('#')) {
      warn(
        `A \`hash\` should always start with the character "#". Replace "${hash}" with "#${hash}".`
      )
    }

    // decoding them) the matcher might have merged current location params so
    // we need to run the decoding again
    matchedRoute.params = normalizeParams(decodeParams(matchedRoute.params))

    const fullPath = stringifyURL(
      stringifyQuery,
      assign({}, rawLocation, {
        hash,
        path: matchedRoute.path,
      })
    )

    let href = routerHistory.createHref(fullPath)
    if (__DEV__) {
      if (href.startsWith('//'))
        warn(
          `Location "${rawLocation}" resolved to "${href}". A resolved location cannot start with multiple slashes.`
        )
      else if (!matchedRoute.matched.length) {
        warn(
          `No match found for location with path "${
            'path' in rawLocation ? rawLocation.path : rawLocation
          }"`
        )
      }
    }

    return assign(
      {
        fullPath,
        // keep the hash encoded so fullPath is effectively path + encodedQuery +
        // hash
        hash,
        query:
          // if the user is using a custom query lib like qs, we might have
          // nested objects, so we keep the query as is, meaning it can contain
          // numbers at `$route.query`, but at the point, the user will have to
          // use their own type anyway.
          // https://github.com/vuejs/vue-router-next/issues/328#issuecomment-649481567
          stringifyQuery === originalStringifyQuery
            ? normalizeQuery(rawLocation.query)
            : (rawLocation.query as LocationQuery),
      },
      matchedRoute,
      {
        redirectedFrom: undefined,
        href,
      }
    )
  }

  function locationAsObject(
    to: RouteLocationRaw | RouteLocationNormalized
  ): Exclude<RouteLocationRaw, string> | RouteLocationNormalized {
    return typeof to === 'string' ? { path: to } : assign({}, to)
  }

  function checkCanceledNavigation(
    to: RouteLocationNormalized,
    from: RouteLocationNormalized
  ): NavigationFailure | void {
    if (pendingLocation !== to) {
      return createRouterError<NavigationFailure>(
        ErrorTypes.NAVIGATION_CANCELLED,
        {
          from,
          to,
        }
      )
    }
  }

  // this.$router.push
  function push(to: RouteLocationRaw | RouteLocation) {
    debugger
    return pushWithRedirect(to)
  }

  function replace(to: RouteLocationRaw | RouteLocationNormalized) {
    return push(assign(locationAsObject(to), { replace: true }))
  }

  // api 式跳转路由
  function pushWithRedirect(
    to: RouteLocationRaw | RouteLocation,
    redirectedFrom?: RouteLocation
  ): Promise<NavigationFailure | void | undefined> {
    const targetLocation: RouteLocation = (pendingLocation = resolve(to))
    const from = currentRoute.value
    const data: HistoryState | undefined = (to as RouteLocationOptions).state
    const force: boolean | undefined = (to as RouteLocationOptions).force
    // to could be a string where `replace` is a function
    const replace = (to as RouteLocationOptions).replace === true

    const lastMatched =
      targetLocation.matched[targetLocation.matched.length - 1]
    if (lastMatched && lastMatched.redirect) {
      const { redirect } = lastMatched
      // transform it into an object to pass the original RouteLocaleOptions
      let newTargetLocation = locationAsObject(
        typeof redirect === 'function' ? redirect(targetLocation) : redirect
      )

      if (
        __DEV__ &&
        !('path' in newTargetLocation) &&
        !('name' in newTargetLocation)
      ) {
        warn(
          `Invalid redirect found:\n${JSON.stringify(
            newTargetLocation,
            null,
            2
          )}\n when navigating to "${
            targetLocation.fullPath
          }". A redirect must contain a name or path. This will break in production.`
        )
        return Promise.reject(new Error('Invalid redirect'))
      }
      return pushWithRedirect(
        assign(
          {
            query: targetLocation.query,
            hash: targetLocation.hash,
            params: targetLocation.params,
          },
          newTargetLocation,
          {
            state: data,
            force,
            replace,
          }
        ),
        // keep original redirectedFrom if it exists
        redirectedFrom || targetLocation
      )
    }

    // if it was a redirect we already called `pushWithRedirect` above
    const toLocation = targetLocation as RouteLocationNormalized

    toLocation.redirectedFrom = redirectedFrom
    let failure: NavigationFailure | void | undefined

    if (!force && isSameRouteLocation(stringifyQuery, from, targetLocation)) {
      failure = createRouterError<NavigationFailure>(
        ErrorTypes.NAVIGATION_DUPLICATED,
        { to: toLocation, from }
      )
      // trigger scroll to allow scrolling to the same anchor
      handleScroll(
        from,
        from,
        // this is a push, the only way for it to be triggered from a
        // history.listen is with a redirect, which makes it become a pus
        true,
        // This cannot be the first navigation because the initial location
        // cannot be manually navigated to
        false
      )
    }

    return (failure ? Promise.resolve(failure) : navigate(toLocation, from))
      .catch((error: NavigationFailure | NavigationRedirectError) => {
        if (
          isNavigationFailure(
            error,
            ErrorTypes.NAVIGATION_ABORTED |
              ErrorTypes.NAVIGATION_CANCELLED |
              ErrorTypes.NAVIGATION_GUARD_REDIRECT
          )
        ) {
          return error
        }
        // unknown error, rejects
        return triggerError(error)
      })
      .then((failure: NavigationFailure | NavigationRedirectError | void) => {
        if (failure) {
          if (
            isNavigationFailure(failure, ErrorTypes.NAVIGATION_GUARD_REDIRECT)
          ) {
            if (
              __DEV__ &&
              // we are redirecting to the same location we were already at
              isSameRouteLocation(
                stringifyQuery,
                resolve(failure.to),
                toLocation
              ) &&
              // and we have done it a couple of times
              redirectedFrom &&
              // @ts-ignore
              (redirectedFrom._count = redirectedFrom._count
                ? // @ts-ignore
                  redirectedFrom._count + 1
                : 1) > 10
            ) {
              warn(
                `Detected an infinite redirection in a navigation guard when going from "${from.fullPath}" to "${toLocation.fullPath}". Aborting to avoid a Stack Overflow. This will break in production if not fixed.`
              )
              return Promise.reject(
                new Error('Infinite redirect in navigation guard')
              )
            }

            return pushWithRedirect(
              // keep options
              assign(locationAsObject(failure.to), {
                state: data,
                force,
                replace,
              }),
              // preserve the original redirectedFrom if any
              redirectedFrom || toLocation
            )
          }
        } else {
          // if we fail we don't finalize the navigation
          failure = finalizeNavigation(
            toLocation as RouteLocationNormalizedLoaded,
            from,
            true,
            replace,
            data
          )
        }
        triggerAfterEach(
          toLocation as RouteLocationNormalizedLoaded,
          from,
          failure
        )
        return failure
      })
  }

  /**
   * Helper to reject and skip all navigation guards if a new navigation happened
   * @param to
   * @param from
   */
  function checkCanceledNavigationAndReject(
    to: RouteLocationNormalized,
    from: RouteLocationNormalized
  ): Promise<void> {
    const error = checkCanceledNavigation(to, from)
    return error ? Promise.reject(error) : Promise.resolve()
  }

  // TODO: refactor the whole before guards by internally using router.beforeEach
  // TODO: 通过内部使用router.beforeEach重构防卫前的整体

  // 执行导航
  function navigate(
    to: RouteLocationNormalized,
    from: RouteLocationNormalizedLoaded
  ): Promise<any> {
    let guards: Lazy<any>[]

    // 这里的所有组件都已经解决了一次，因为我们要离开
    // all components here have been resolved once because we are leaving
    // 提取组件的 beforeRouteLeave 守卫函数
    guards = extractComponentsGuards(
      from.matched.filter(record => to.matched.indexOf(record) < 0).reverse(),
      'beforeRouteLeave',
      to,
      from
    )

    const [
      leavingRecords,
      updatingRecords,
      // enteringRecords,
    ] = extractChangingRecords(to, from)

    for (const record of leavingRecords) {
      for (const guard of record.leaveGuards) {
        guards.push(guardToPromiseFn(guard, to, from))
      }
    }

    const canceledNavigationCheck = checkCanceledNavigationAndReject.bind(
      null,
      to,
      from
    )

    guards.push(canceledNavigationCheck)

    // run the queue of per route beforeRouteLeave guards
    return (
      runGuardQueue(guards)
        .then(() => {
          // check global guards beforeEach
          guards = []
          // 执行守卫函数
          for (const guard of beforeGuards.list()) {
            guards.push(guardToPromiseFn(guard, to, from))
          }
          guards.push(canceledNavigationCheck)

          return runGuardQueue(guards)
        })
        .then(() => {
          // check in components beforeRouteUpdate
          guards = extractComponentsGuards(
            to.matched.filter(
              record => from.matched.indexOf(record as any) > -1
            ),
            'beforeRouteUpdate',
            to,
            from
          )

          for (const record of updatingRecords) {
            for (const guard of record.updateGuards) {
              guards.push(guardToPromiseFn(guard, to, from))
            }
          }
          guards.push(canceledNavigationCheck)

          // run the queue of per route beforeEnter guards
          return runGuardQueue(guards)
        })
        .then(() => {
          // check the route beforeEnter
          guards = []
          for (const record of to.matched) {
            // do not trigger beforeEnter on reused views
            if (record.beforeEnter && from.matched.indexOf(record as any) < 0) {
              if (Array.isArray(record.beforeEnter)) {
                for (const beforeEnter of record.beforeEnter)
                  guards.push(guardToPromiseFn(beforeEnter, to, from))
              } else {
                guards.push(guardToPromiseFn(record.beforeEnter, to, from))
              }
            }
          }
          guards.push(canceledNavigationCheck)

          // run the queue of per route beforeEnter guards
          return runGuardQueue(guards)
        })
        .then(() => {
          // NOTE: at this point to.matched is normalized and does not contain any () => Promise<Component>

          // clear existing enterCallbacks, these are added by extractComponentsGuards
          to.matched.forEach(record => (record.enterCallbacks = {}))

          // check in-component beforeRouteEnter
          guards = extractComponentsGuards(
            // the type doesn't matter as we are comparing an object per reference
            to.matched.filter(
              record => from.matched.indexOf(record as any) < 0
            ),
            'beforeRouteEnter',
            to,
            from
          )
          guards.push(canceledNavigationCheck)

          // run the queue of per route beforeEnter guards
          return runGuardQueue(guards)
        })
        .then(() => {
          // check global guards beforeResolve
          guards = []
          for (const guard of beforeResolveGuards.list()) {
            guards.push(guardToPromiseFn(guard, to, from))
          }
          guards.push(canceledNavigationCheck)

          return runGuardQueue(guards)
        })
        // catch any navigation canceled
        .catch(err =>
          isNavigationFailure(err, ErrorTypes.NAVIGATION_CANCELLED)
            ? err
            : Promise.reject(err)
        )
    )
  }

  function triggerAfterEach(
    to: RouteLocationNormalizedLoaded,
    from: RouteLocationNormalizedLoaded,
    failure?: NavigationFailure | void
  ): void {
    // navigation is confirmed, call afterGuards
    // TODO: wrap with error handlers
    for (const guard of afterGuards.list()) guard(to, from, failure)
  }

  /**
   * 完成导航
   * - Cleans up any navigation guards
   * - Changes the url if necessary
   * - Calls the scrollBehavior
   */
  function finalizeNavigation(
    toLocation: RouteLocationNormalizedLoaded,
    from: RouteLocationNormalizedLoaded,
    isPush: boolean,
    replace?: boolean,
    data?: HistoryState
  ): NavigationFailure | void {
    // 最近的导航发生了 error ？
    // a more recent navigation took place
    const error = checkCanceledNavigation(toLocation, from)
    if (error) return error

    const [leavingRecords] = extractChangingRecords(toLocation, from)
    for (const record of leavingRecords) {
      // 从已删除的匹配记录中删除已注册的守卫
      // remove registered guards from removed matched records
      record.leaveGuards = []
      record.updateGuards = []
      // free the references
      record.instances = {}
      record.enterCallbacks = {}
    }

    // 如果不是第一次导航，则仅视为推送
    // only consider as push if it's not the first navigation
    const isFirstNavigation = from === START_LOCATION_NORMALIZED
    const state = !isBrowser ? {} : history.state

    // change URL only if the user did a push/replace and if it's not the initial navigation because
    // it's just reflecting the url
    if (isPush) {
      // on the initial navigation, we want to reuse the scroll position from
      // history state if it exists
      if (replace || isFirstNavigation)
        routerHistory.replace(
          toLocation.fullPath,
          assign(
            {
              scroll: isFirstNavigation && state && state.scroll,
            },
            data
          )
        )
      else routerHistory.push(toLocation.fullPath, data)
    }

    // accept current navigation
    currentRoute.value = toLocation
    handleScroll(toLocation, from, isPush, isFirstNavigation)

    markAsReady()
  }

  let removeHistoryListener: () => void

  // 将侦听器附加到历史记录以触发导航
  // attach listener to history to trigger navigations
  function setupListeners() {
    removeHistoryListener = routerHistory.listen((to, _from, info) => {
      // cannot be a redirect route because it was in history
      const toLocation = resolve(to) as RouteLocationNormalized

      pendingLocation = toLocation
      const from = currentRoute.value

      // TODO: should be moved to web history?
      if (isBrowser) {
        saveScrollPosition(
          getScrollKey(from.fullPath, info.delta),
          computeScrollPosition()
        )
      }

      // 执行导航，会执行守卫函数
      navigate(toLocation, from)
        .catch((error: NavigationFailure | NavigationRedirectError) => {
          if (
            isNavigationFailure(
              error,
              ErrorTypes.NAVIGATION_ABORTED | ErrorTypes.NAVIGATION_CANCELLED
            )
          ) {
            return error
          }
          if (
            isNavigationFailure(error, ErrorTypes.NAVIGATION_GUARD_REDIRECT)
          ) {
            // do not restore history on unknown direction
            if (info.delta) routerHistory.go(-info.delta, false)
            // the error is already handled by router.push we just want to avoid
            // logging the error
            pushWithRedirect(
              (error as NavigationRedirectError).to,
              toLocation
              // avoid an uncaught rejection
            ).catch(noop)
            // avoid the then branch
            return Promise.reject()
          }
          // do not restore history on unknown direction
          if (info.delta) routerHistory.go(-info.delta, false)
          // unrecognized error, transfer to the global handler
          return triggerError(error)
        })
        .then((failure: NavigationFailure | void) => {
          failure =
            failure ||
            finalizeNavigation(
              // after navigation, all matched components are resolved
              toLocation as RouteLocationNormalizedLoaded,
              from,
              false
            )

          // revert the navigation
          if (failure && info.delta) routerHistory.go(-info.delta, false)

          triggerAfterEach(
            toLocation as RouteLocationNormalizedLoaded,
            from,
            failure
          )
        })
        .catch(noop)
    })
  }

  // Initialization and Errors

  let readyHandlers = useCallbacks<OnReadyCallback>()
  let errorHandlers = useCallbacks<ErrorHandler>()
  let ready: boolean

  /**
   * Trigger errorHandlers added via onError and throws the error as well
   * @param error - error to throw
   * @returns the error as a rejected promise
   */
  function triggerError(error: any) {
    markAsReady(error)
    errorHandlers.list().forEach(handler => handler(error))
    return Promise.reject(error)
  }

  /**
   * Returns a Promise that resolves or reject when the router has finished its
   * initial navigation. This will be automatic on client but requires an
   * explicit `router.push` call on the server. This behavior can change
   * depending on the history implementation used e.g. the defaults history
   * implementation (client only) triggers this automatically but the memory one
   * (should be used on server) doesn't
   */
  function isReady(): Promise<void> {
    if (ready && currentRoute.value !== START_LOCATION_NORMALIZED)
      return Promise.resolve()
    return new Promise((resolve, reject) => {
      readyHandlers.add([resolve, reject])
    })
  }

  /**
   * Mark the router as ready, resolving the promised returned by isReady(). Can
   * only be called once, otherwise does nothing.
   * @param err - optional error
   */
  function markAsReady(err?: any): void {
    if (ready) return
    ready = true
    setupListeners()
    readyHandlers
      .list()
      .forEach(([resolve, reject]) => (err ? reject(err) : resolve()))
    readyHandlers.reset()
  }

  // Scroll behavior
  function handleScroll(
    to: RouteLocationNormalizedLoaded,
    from: RouteLocationNormalizedLoaded,
    isPush: boolean,
    isFirstNavigation: boolean
  ): Promise<any> {
    if (!isBrowser || !scrollBehavior) return Promise.resolve()

    let scrollPosition: _ScrollPositionNormalized | null =
      (!isPush && getSavedScrollPosition(getScrollKey(to.fullPath, 0))) ||
      ((isFirstNavigation || !isPush) &&
        (history.state as HistoryState) &&
        history.state.scroll) ||
      null

    return nextTick()
      .then(() => scrollBehavior!(to, from, scrollPosition))
      .then(position => position && scrollToPosition(position))
      .catch(triggerError)
  }

  function go(delta: number) {
    return new Promise<NavigationFailure | void | undefined>(
      (resolve, reject) => {
        let removeError = errorHandlers.add(err => {
          removeError()
          removeAfterEach()
          reject(err)
        })
        let removeAfterEach = afterGuards.add((_to, _from, failure) => {
          removeError()
          removeAfterEach()
          resolve(failure)
        })

        routerHistory.go(delta)
      }
    )
  }

  let started: boolean | undefined
  const installedApps = new Set<App>()

  const router: Router = {
    currentRoute,

    addRoute,
    removeRoute,
    hasRoute,
    getRoutes,
    resolve,
    options,

    push,
    replace,
    go,
    // 后退
    back: () => go(-1),
    // 前进
    forward: () => go(1),

    // 守卫函数. 传入一个函数作为参数， 往 list 数组中加入一个回调函数。
    beforeEach: beforeGuards.add,
    beforeResolve: beforeResolveGuards.add,
    afterEach: afterGuards.add,

    onError: errorHandlers.add,
    isReady,

    // app.use(router) 调用的函数
    install(app: App) {
      const router = this
      app.component('RouterLink', RouterLink)
      app.component('RouterView', RouterView)

      app.config.globalProperties.$router = router
      Object.defineProperty(app.config.globalProperties, '$route', {
        get: () => unref(currentRoute),
      })

      // this initial navigation is only necessary on client, on server it doesn't
      // make sense because it will create an extra unnecessary navigation and could
      // lead to problems
      if (
        isBrowser &&
        // used for the initial navigation client side to avoid pushing
        // multiple times when the router is used in multiple apps
        !started &&
        currentRoute.value === START_LOCATION_NORMALIZED
      ) {
        // see above
        started = true
        push(routerHistory.location).catch(err => {
          if (__DEV__) warn('Unexpected error when starting the router:', err)
        })
      }

      const reactiveRoute = {} as {
        [k in keyof RouteLocationNormalizedLoaded]: ComputedRef<
          RouteLocationNormalizedLoaded[k]
        >
      }
      // route 对象每一个属性都是计算属性，因为反正也不可修改
      for (let key in START_LOCATION_NORMALIZED) {
        // @ts-ignore: the key matches
        reactiveRoute[key] = computed(() => currentRoute.value[key])
      }

      app.provide(routerKey, router)
      // 根实例上提供 routeLocationKey 对象，值是响应式的 route
      app.provide(routeLocationKey, reactive(reactiveRoute))

      // 卸载函数
      let unmountApp = app.unmount
      installedApps.add(app)
      app.unmount = function () {
        installedApps.delete(app)
        if (installedApps.size < 1) {
          removeHistoryListener()
          currentRoute.value = START_LOCATION_NORMALIZED
          started = false
          ready = false
        }
        unmountApp.call(this, arguments)
      }
    },
  }

  return router
}

function runGuardQueue(guards: Lazy<any>[]): Promise<void> {
  return guards.reduce(
    (promise, guard) => promise.then(() => guard()),
    Promise.resolve()
  )
}

function extractChangingRecords(
  to: RouteLocationNormalized,
  from: RouteLocationNormalizedLoaded
) {
  const leavingRecords: RouteRecordNormalized[] = []
  const updatingRecords: RouteRecordNormalized[] = []
  const enteringRecords: RouteRecordNormalized[] = []

  const len = Math.max(from.matched.length, to.matched.length)
  for (let i = 0; i < len; i++) {
    const recordFrom = from.matched[i]
    if (recordFrom) {
      if (to.matched.indexOf(recordFrom) < 0) leavingRecords.push(recordFrom)
      else updatingRecords.push(recordFrom)
    }
    const recordTo = to.matched[i]
    if (recordTo) {
      // the type doesn't matter because we are comparing per reference
      if (from.matched.indexOf(recordTo as any) < 0)
        enteringRecords.push(recordTo)
    }
  }

  return [leavingRecords, updatingRecords, enteringRecords]
}
