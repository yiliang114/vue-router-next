import { isBrowser } from '../utils'
import { removeTrailingSlash } from '../location'

export type HistoryLocation = string
//pushState克隆传递的状态，不接受所有内容
//它不接受符号，也不作为值使用。它还忽略符号作为键
// pushState clones the state passed and do not accept everything
// it doesn't accept symbols, nor functions as values. It also ignores Symbols as keys
type HistoryStateValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | HistoryState
  | HistoryStateArray

export interface HistoryState {
  [x: number]: HistoryStateValue
  [x: string]: HistoryStateValue
}
interface HistoryStateArray extends Array<HistoryStateValue> {}

export enum NavigationType {
  pop = 'pop',
  push = 'push',
}

export enum NavigationDirection {
  back = 'back',
  forward = 'forward',
  unknown = '',
}

export interface NavigationInformation {
  type: NavigationType
  direction: NavigationDirection
  delta: number
}

export interface NavigationCallback {
  (
    to: HistoryLocation,
    from: HistoryLocation,
    information: NavigationInformation
  ): void
}

/**
 * 历史记录的起始位置
 * Starting location for Histories
 */
export const START: HistoryLocation = ''

export type ValueContainer<T> = { value: T }

/**
 * 历史记录实现所实现的接口可以传递给 router
 * Interface implemented by History implementations that can be passed to the
 * router as {@link Router.history}
 *
 * @alpha
 */
export interface RouterHistory {
  /**
   *  附加在每个URL前面的基本路径。这样就可以在
   *  域的子文件夹（如“ example.com/subfolder”），其“ base”为
   *`/子文件夹`
   * Base path that is prepended to every url. This allows hosting an SPA at a
   * subfolder of a domain like `example.com/subfolder` by having a `base` of
   * `/subfolder`
   */
  readonly base: string
  /**
   * 当前历史记录位置
   * Current History location
   */
  readonly location: HistoryLocation
  /**
   * 当前历史状态
   * Current History state
   */
  readonly state: HistoryState
  // readonly location: ValueContainer<HistoryLocationNormalized>

  /**
   * 导航到一个位置。对于HTML5历史记录实施，
   * 这将调用`history.pushState`以有效地更改URL
   * Navigates to a location. In the case of an HTML5 History implementation,
   * this will call `history.pushState` to effectively change the URL.
   *
   * @param to - location to push
   * @param data - optional {@link HistoryState} to be associated with the
   * navigation entry
   */
  push(to: HistoryLocation, data?: HistoryState): void
  /**
   * 与{@link RouterHistory.push}相同，但执行的是“ history.replaceState”
   * 而不是`history.pushState`
   *
   * @param到-要设置的位置
   * @param数据-可选的{@link HistoryState}与导航条目
   *
   * Same as {@link RouterHistory.push} but performs a `history.replaceState`
   * instead of `history.pushState`
   *
   * @param to - location to set
   * @param data - optional {@link HistoryState} to be associated with the
   * navigation entry
   */
  replace(to: HistoryLocation, data?: HistoryState): void

  /**
   * 沿给定方向遍历历史
   * Traverses history in a given direction.
   *
   * @example
   * ```js
   * myHistory.go(-1) // equivalent to window.history.back()
   * myHistory.go(1) // equivalent to window.history.forward()
   * ```
   *
   * @param delta-行驶距离。如果delta为\ <0，它将返回 如果它是\> 0，它将按该条目的数量前进。
   * @param triggerListeners-是否应该触发附加到的监听器历史
   *
   * @param delta - distance to travel. If delta is \< 0, it will go back,
   * if it's \> 0, it will go forward by that amount of entries.
   * @param triggerListeners - whether this should trigger listeners attached to
   * the history
   */
  go(delta: number, triggerListeners?: boolean): void

  /**
   * 将侦听器附加到历史记录实现，该实现在以下情况下触发
   * 导航是从外部触发的（例如浏览器来回移动）
   * 按钮），或者在将true传递给{@link RouterHistory.back}时，以及
   * {@link RouterHistory.forward}
   *
   * @param回调-附加的侦听器
   * @返回回调以删除侦听器
   *
   * Attach a listener to the History implementation that is triggered when the
   * navigation is triggered from outside (like the Browser back and forward
   * buttons) or when passing `true` to {@link RouterHistory.back} and
   * {@link RouterHistory.forward}
   *
   * @param callback - listener to attach
   * @returns a callback to remove the listener
   */
  listen(callback: NavigationCallback): () => void

  /**
   *
   * 生成要在锚标记中使用的相应href。
   *
   * @param location-应该创建href的历史记录位置
   *
   * Generates the corresponding href to be used in an anchor tag.
   *
   * @param location - history location that should create an href
   */
  createHref(location: HistoryLocation): string

  /**
   * 清除历史记录实现附加的所有事件侦听器。
   * Clears any event listener attached by the history implementation.
   */
  destroy(): void
}

// Generic utils

/**
 * 通过删除任何斜杠并读取base标签来规范化 base 当下
 * Normalizes a base by removing any trailing slash and reading the base tag if
 * present.
 *
 * @param base - base to normalize
 */
export function normalizeBase(base?: string): string {
  if (!base) {
    if (isBrowser) {
      // respect <base> tag 根据 base 标签的 href 来作为 router 的 base
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin 剥离 url 的 origin 头
      base = base.replace(/^\w+:\/\/[^\/]+/, '')
    } else {
      // 保证 base 是个字符串，否则下面的下面将不能取值
      base = '/'
    }
  }

  // 如果 base 没有携带 / 或者 # 就手动拼接上
  // ensure leading slash when it was removed by the regex above avoid leading
  // slash with hash because the file could be read from the disk like file://
  // and the leading slash would cause problems
  if (base[0] !== '/' && base[0] !== '#') base = '/' + base

  // 删除尾部的斜杠，以便其他方法能够直接使用 `base + fullPath` 去创建一个 url。 需要注意的是 base 如果传的是 `'/'` 最终会变成 `''`
  // remove the trailing slash so all other method can just do `base + fullPath`
  // to build an href
  return removeTrailingSlash(base)
}

// remove any character before the hash 删除哈希之前的任何字符
const BEFORE_HASH_RE = /^[^#]+#/
export function createHref(base: string, location: HistoryLocation): string {
  return base.replace(BEFORE_HASH_RE, '#') + location
}
