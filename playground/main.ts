// necessary for webpack
///<reference path="../src/global.d.ts"/>
import { createApp, App as Application } from 'vue'
import { router, routerHistory } from './router'
import { globalState } from './store'
import App from './App.vue'

declare global {
  interface Window {
    // h: HTML5History
    h: typeof routerHistory
    r: typeof router
    vm: ReturnType<Application['mount']>
  }
}

// for testing purposes
window.h = routerHistory
window.r = router
// 创建一个实例
const app = createApp(App)
// 根实例上提供一个 state 对象。 就可以不用 vuex 了。 挺好
app.provide('state', globalState)
// 根实例使用 router, 在需要的子组件里面通过 useRoute 注入 route
app.use(router)

window.vm = app.mount('#app')
