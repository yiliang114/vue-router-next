import {
  RouterHistory,
  NavigationCallback,
  NavigationType,
  NavigationDirection,
  HistoryState,
  ValueContainer,
  normalizeBase,
  createHref,
  HistoryLocation,
} from './common'
import {
  computeScrollPosition,
  _ScrollPositionNormalized,
} from '../scrollBehavior'
import { warn } from '../warning'
import { stripBase } from '../location'
import { assign } from '../utils'

type PopStateListener = (this: Window, ev: PopStateEvent) => any

// FIXME: 是否可以用 const 呢
let createBaseLocation = () => location.protocol + '//' + location.host

interface StateEntry extends HistoryState {
  back: HistoryLocation | null
  current: HistoryLocation
  forward: HistoryLocation | null
  position: number
  replaced: boolean
  scroll: _ScrollPositionNormalized | null | false
}

/**
 * 从 window.location 对象创建归一化的 历史记录 位置
 * Creates a normalized history location from a window.location object
 * @param location
 */
function createCurrentLocation(
  base: string,
  location: Location
): HistoryLocation {
  const { pathname, search, hash } = location
  // FIXME: 这里可以缩进去
  // allows hash based url 允许哈希 base 的 url
  const hashPos = base.indexOf('#')
  if (hashPos > -1) {
    // FIXME: 这里应该是以 / 开头吧。。。
    // 在开始斜杠前添加哈希以使 URL 以 /# 开头
    // prepend the starting slash to hash so the url starts with /#
    let pathFromHash = hash.slice(1)
    if (pathFromHash[0] !== '/') pathFromHash = '/' + pathFromHash
    // FIXME: 这里直接可以 return pathFromHash 了
    return stripBase(pathFromHash, '')
  }
  // 剥离 pathname 中的 base
  const path = stripBase(pathname, base)
  // 3 者拼接之后返回
  return path + search + hash
}

function useHistoryListeners(
  base: string,
  historyState: ValueContainer<StateEntry>,
  currentLocation: ValueContainer<HistoryLocation>,
  replace: RouterHistory['replace']
) {
  let listeners: NavigationCallback[] = []
  let teardowns: Array<() => void> = []
  // 应该是堆栈吗？一个字典。检查 popstate 侦听器 可以触发两次
  // TODO: should it be a stack? a Dict. Check if the popstate listener
  // can trigger twice
  // 暂存属性 ？
  let pauseState: HistoryLocation | null = null

  // popState 更新的时候执行的函数
  const popStateHandler: PopStateListener = ({
    state,
  }: {
    state: StateEntry | null
  }) => {
    // location: window.location
    const to = createCurrentLocation(base, location)
    const from: HistoryLocation = currentLocation.value
    const fromState: StateEntry = historyState.value
    let delta = 0

    if (state) {
      currentLocation.value = to
      historyState.value = state

      // 忽略 popstate 并重置 pauseState
      // ignore the popstate and reset the pauseState
      if (pauseState && pauseState === from) {
        pauseState = null
        return
      }
      delta = fromState ? state.position - fromState.position : 0
    } else {
      replace(to)
    }

    // console.log({ deltaFromCurrent })
    // Here we could also revert the navigation by calling history.go(-delta)
    // this listener will have to be adapted to not trigger again and to wait for the url
    // to be updated before triggering the listeners. Some kind of validation function would also
    // need to be passed to the listeners so the navigation can be accepted
    // call all listeners
    listeners.forEach(listener => {
      listener(currentLocation.value, from, {
        delta,
        type: NavigationType.pop,
        direction: delta
          ? delta > 0
            ? NavigationDirection.forward
            : NavigationDirection.back
          : NavigationDirection.unknown,
      })
    })
  }

  // 暂停监听器
  function pauseListeners() {
    pauseState = currentLocation.value
  }

  function listen(callback: NavigationCallback) {
    // 建立监听器并准备拆卸回调
    // setup the listener and prepare teardown callbacks
    listeners.push(callback)

    const teardown = () => {
      const index = listeners.indexOf(callback)
      if (index > -1) listeners.splice(index, 1)
    }

    teardowns.push(teardown)
    // 返回一个拆卸函数，从 listeners 中剥离当前的回调函数
    return teardown
  }

  // 在浏览器关闭、前进、后退之前执行的操作，需要更新 history.state
  function beforeUnloadListener() {
    const { history } = window
    if (!history.state) return
    history.replaceState(
      assign({}, history.state, { scroll: computeScrollPosition() }),
      ''
    )
  }

  function destroy() {
    // 执行全部拆卸函数
    for (const teardown of teardowns) teardown()
    teardowns = []
    window.removeEventListener('popstate', popStateHandler)
    window.removeEventListener('beforeunload', beforeUnloadListener)
  }

  // history 模式不刷新页面更新路由的监听方法
  // setup the listeners and prepare teardown callbacks
  window.addEventListener('popstate', popStateHandler)
  // 关闭浏览器、后退、前进等
  window.addEventListener('beforeunload', beforeUnloadListener)

  return {
    pauseListeners,
    listen,
    destroy,
  }
}

/**
 * Creates a state object
 */
function buildState(
  back: HistoryLocation | null,
  current: HistoryLocation,
  forward: HistoryLocation | null,
  replaced: boolean = false,
  computeScroll: boolean = false
): StateEntry {
  return {
    back,
    current,
    forward,
    replaced,
    position: window.history.length,
    scroll: computeScroll ? computeScrollPosition() : null,
  }
}

function useHistoryStateNavigation(base: string) {
  // window 中解构，说明应该在 ssr 环境下应该不能使用 ？ TODO:
  const { history, location } = window

  // private variables 私有变量
  let currentLocation: ValueContainer<HistoryLocation> = {
    // value 值是一个当前 location 拼接而成的字符串。 path + query
    value: createCurrentLocation(base, location),
  }
  // TODO: 理论上没有调用两个函数，history.state 是空的，但是实际上是有值的。。。
  // history.state 返回栈顶的 state 拷贝。 如果没有使用过 pushState() 或者 replaceState() 函数，history.state 值将为 null
  let historyState: ValueContainer<StateEntry> = { value: history.state }
  // 建立当前的历史记录条目，因为这是一个全新的导航
  // build current history entry as this is a fresh navigation
  if (!historyState.value) {
    // 没有 state 的话，初始一下 state
    changeLocation(
      currentLocation.value,
      {
        back: null,
        current: currentLocation.value,
        forward: null,
        // the length is off by one, we need to decrease it
        position: history.length - 1,
        replaced: true,
        // don't add a scroll as the user may have an anchor and we want
        // scrollBehavior to be triggered without a saved position
        scroll: null,
      },
      true
    )
  }

  function changeLocation(
    to: HistoryLocation,
    state: StateEntry,
    replace: boolean
  ): void {
    const url =
      // base
      createBaseLocation() +
      // 当 base 有哈希值时保留所有现有查询
      // preserve any existing query when base has a hash
      (base.indexOf('#') > -1 && location.search
        ? location.pathname + location.search + '#'
        : base) +
      to
    try {
      // BROWSER QUIRK
      // NOTE: Safari throws a SecurityError when calling this function 100 times in 30 seconds
      // 调用函数更新 state. replaceState 与 pushState 的区别在于，replaceState() 是修改了当前的历史记录项而不是新建一个
      history[replace ? 'replaceState' : 'pushState'](state, '', url)
      // 更新 historyState 的值
      historyState.value = state
    } catch (err) {
      warn('Error with push/replace State', err)
      // 强制用 location 进行导航，这也会重置通话计数（估计会重新刷新页面， state 值应该也都不在了）
      // Force the navigation, this also resets the call count
      location[replace ? 'replace' : 'assign'](url)
    }
  }

  function replace(to: HistoryLocation, data?: HistoryState) {
    const state: StateEntry = assign(
      {},
      history.state,
      buildState(
        historyState.value.back,
        // keep back and forward entries but override current position
        to,
        historyState.value.forward,
        true
      ),
      data,
      { position: historyState.value.position }
    )

    changeLocation(to, state, true)
    currentLocation.value = to
  }

  function push(to: HistoryLocation, data?: HistoryState) {
    // Add to current entry the information of where we are going
    // as well as saving the current position
    const currentState: StateEntry = assign({}, history.state, {
      forward: to,
      scroll: computeScrollPosition(),
    })
    changeLocation(currentState.current, currentState, true)

    const state: StateEntry = assign(
      {},
      buildState(currentLocation.value, to, null),
      {
        position: currentState.position + 1,
      },
      data
    )

    changeLocation(to, state, false)
    currentLocation.value = to
  }

  return {
    location: currentLocation,
    state: historyState,

    push,
    replace,
  }
}

export function createWebHistory(base?: string): RouterHistory {
  // 规范化 base. 末尾的斜杠默认会被去掉，也就是说 base 如果是 undefined 的话，最终结果是 ""
  base = normalizeBase(base)
  // history 导航
  const historyNavigation = useHistoryStateNavigation(base)
  // history 监听器
  const historyListeners = useHistoryListeners(
    base,
    historyNavigation.state,
    historyNavigation.location,
    historyNavigation.replace
  )

  function go(delta: number, triggerListeners = true) {
    if (!triggerListeners) historyListeners.pauseListeners()
    history.go(delta)
  }

  const routerHistory: RouterHistory = assign(
    {
      // 它在之后被覆盖 it's overridden right after
      location: '',
      base,
      go,
      createHref: createHref.bind(null, base),
    },

    historyNavigation,
    historyListeners
  )

  // 说白了就是不让直接修改 location 和 state 值
  Object.defineProperty(routerHistory, 'location', {
    get: () => historyNavigation.location.value,
  })

  Object.defineProperty(routerHistory, 'state', {
    get: () => historyNavigation.state.value,
  })

  // { base, location, state, createHref, go, push, replace, pauseListeners, listen, destroy, ... }
  return routerHistory
}
