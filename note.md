# router note

https://juejin.im/post/6844903558576341000

## API

路由模式：

1. createWebHistory
2. createMemoryHistory
3. createWebHashHistory
4. createRouterMatcher

创建路由：

- createRouter

```js
const history = createMemoryHistory()
const router = createRouter({
  history,
  routes: [
    { path: '/', component },
    { path: '/redirect', redirect: { params: { foo: 'f' } } },
  ],
})
```
