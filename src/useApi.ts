import { inject } from 'vue'
import { routerKey, routeLocationKey } from './injectionSymbols'
import { Router } from './router'
import { RouteLocationNormalizedLoaded } from './types'

// 值应该是 this.$router, 携带一些函数例如 push replace 等
export function useRouter(): Router {
  return inject(routerKey)!
}

// provide 与 inject 是一一对一个的，父组件 provide 的值一定可以在子组件通过 inject 获取到
// 往调用的组件里，注入一个路由。 值是当前的路由对象，this.$route
export function useRoute(): RouteLocationNormalizedLoaded {
  return inject(routeLocationKey)!
}
