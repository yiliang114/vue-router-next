import {
  RouteRecordMultipleViews,
  NavigationGuard,
  _RouteRecordBase,
  _RouteRecordProps,
  NavigationGuardNextCallback,
} from '../types'
import { ComponentPublicInstance } from 'vue'

// normalize component/components into components and make every property always present
export interface RouteRecordNormalized {
  /**
   * {@inheritDoc _RouteRecordBase.path}
   */
  path: _RouteRecordBase['path']
  /**
   * {@inheritDoc _RouteRecordBase.redirect}
   */
  redirect: _RouteRecordBase['redirect'] | undefined
  /**
   * {@inheritDoc _RouteRecordBase.name}
   */
  name: _RouteRecordBase['name']
  /**
   * {@inheritDoc RouteRecordMultipleViews.components}
   */
  components: RouteRecordMultipleViews['components']
  /**
   * {@inheritDoc _RouteRecordBase.components}
   */
  children: Exclude<_RouteRecordBase['children'], void>
  /**
   * {@inheritDoc _RouteRecordBase.meta}
   */
  meta: Exclude<_RouteRecordBase['meta'], void>
  /**
   * {@inheritDoc RouteRecordMultipleViews.props}
   */
  props: Record<string, _RouteRecordProps>
  /**
   * {@inheritDoc _RouteRecordBase.props}
   */
  beforeEnter: RouteRecordMultipleViews['beforeEnter']
  /**
   * Registered leave guards
   *
   * @internal
   */
  leaveGuards: NavigationGuard[]
  /**
   * Registered update guards
   *
   * @internal
   */
  updateGuards: NavigationGuard[]
  /**
   * Registered beforeRouteEnter callbacks passed to `next` or returned in guards
   *
   * @internal
   */
  enterCallbacks: Record<string, NavigationGuardNextCallback[]>
  /**
   * Mounted route component instances
   * Having the instances on the record mean beforeRouteUpdate and
   * beforeRouteLeave guards can only be invoked with the latest mounted app
   * instance if there are multiple application instances rendering the same
   * view, basically duplicating the content on the page, which shouldn't happen
   * in practice. It will work if multiple apps are rendering different named
   * views.
   */
  instances: Record<string, ComponentPublicInstance | undefined | null>
  // can only be of of the same type as this record
  /**
   * *定义该记录是否为另一条记录的别名。该属性是 `undefined`，如果记录是原始记录。
   * Defines if this record is the alias of another one. This property is
   * `undefined` if the record is the original one.
   */
  aliasOf: RouteRecordNormalized | undefined
}

export type RouteRecord = RouteRecordNormalized
