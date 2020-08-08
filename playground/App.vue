<template>
  可怕，会被一个 chrome 插件搞的只显示 json
  <div>
    <pre>{{ currentLocation }}</pre>
    <section class="info">
      Name:
      <pre id="name">{{ currentLocation.name }}</pre>
    </section>

    <section class="info">
      Params:
      <pre id="params">{{ currentLocation.params }}</pre>
    </section>

    <section class="info">
      Query:
      <pre id="query">{{ currentLocation.query }}</pre>
    </section>

    <section class="info">
      Hash:
      <pre id="hash">{{ currentLocation.hash }}</pre>
    </section>

    <section class="info">
      FullPath:
      <pre id="fullPath">{{ currentLocation.fullPath }}</pre>
    </section>

    <section class="info">
      path:
      <pre id="path">{{ currentLocation.path }}</pre>
    </section>

    <hr />

    <label>
      <input type="checkbox" v-model="state.cancelNextNavigation" /> Cancel Next
      Navigation
    </label>
    <ul>
      <li>
        <router-link to="/n/%E2%82%AC">/n/%E2%82%AC</router-link>
      </li>
      <li>
        <router-link :to="{ name: 'docs', params: { id: '€uro' } }">/docs/€uro (object)</router-link>
      </li>
      <li>
        <router-link
          :to="{ path: '/', query: { currency: '€uro', é: 'e' } }"
        >/currency=€uro&é=e (object)</router-link>
      </li>
      <li>
        <router-link to="/documents/€">/n/€</router-link>
      </li>
      <li>
        <a href="/documents/%E2%82%AC">/documents/%E2%82%AC (force reload)</a>
      </li>
      <li>
        <a href="/documents/€">/documents/€ (force reload): not valid tho</a>
      </li>
      <li>
        <router-link to="/home">Home (redirects)</router-link>
      </li>
      <li>
        <router-link to="/">Home</router-link>
      </li>
      <li>
        <router-link to="/always-redirect">/always-redirect</router-link>
      </li>
      <li>
        <router-link to="/children">/children</router-link>
      </li>
      <li>
        <router-link to="/children/alias">/children/alias</router-link>
      </li>
      <li>
        <router-link :to="{ name: 'default-child' }">/children (child named)</router-link>
      </li>
      <li>
        <router-link :to="{ name: 'WithChildren' }">/children (parent named)</router-link>
      </li>
      <li>
        <router-link to="/children/a">/children/a</router-link>
      </li>
      <li>
        <router-link to="/children/b">/children/b</router-link>
      </li>
      <li>
        <router-link to="/children/b/a2">/children/b/a2</router-link>
      </li>
      <li>
        <router-link to="/children/b/b2">/children/b/b2</router-link>
      </li>
      <li>
        <router-link to="/nested">/nested</router-link>
      </li>
      <li>
        <router-link to="/anidado">/anidado</router-link>
      </li>
      <li>
        <router-link to="/long-0">/long-0</router-link>
      </li>
      <li>
        <router-link to="/users/5">/users/5</router-link>
      </li>
      <li>
        <router-link
          :to="{
            name: 'user',
            params: { id: '' + (Number(currentLocation.params.id || 0) + 1) },
          }"
        >/users/{{ Number(currentLocation.params.id || 0) + 1 }}</router-link>
      </li>
      <li>
        <router-link to="/with-data">/with-data</router-link>
      </li>
      <li>
        <router-link to="/cant-leave">/cant-leave</router-link>
      </li>
      <li>
        <router-link :to="{ name: 'docs', params: { id: 'é' } }">/docs/é</router-link>
      </li>
      <li>
        <router-link to="/rep">/rep</router-link>
      </li>
      <li>
        <router-link to="/rep/a">/rep/a</router-link>
      </li>
      <li>
        <router-link to="/rep/a/b">/rep/a/b</router-link>
      </li>
      <li>
        <router-link to="/parent/1">/parent/1</router-link>
      </li>
      <li>
        <router-link to="/p/1">/p/1</router-link>
      </li>
      <li>
        <router-link to="/parent/1/as-absolute-a">/parent/1/as-absolute-a</router-link>
      </li>
      <li>
        <router-link to="/p/1/as-absolute-a">/p/1/as-absolute-a</router-link>
      </li>
      <li>
        <router-link to="/p_1/absolute-a">/p_1/absolute-a</router-link>
      </li>
    </ul>
    <button @click="toggleViewName">Toggle view</button>
    <Suspense>
      <template #default>
        <router-view :name="viewName" v-slot="{ Component }">
          <transition
            name="fade"
            mode="out-in"
            @before-enter="flushWaiter"
            @before-leave="setupWaiter"
          >
            <keep-alive>
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </template>
      <template #fallback>Loading...</template>
    </Suspense>
  </div>
</template>

<script>
import { defineComponent, inject, computed, ref } from 'vue'
import { scrollWaiter } from './scrollWaiter'
import { useRoute } from '../src'

// vue 3 创建有一个组件
export default defineComponent({
  name: 'App',
  setup() {
    // hooks 形式的 router
    const route = useRoute()
    // TODO: 暂时不清楚这个用法
    const state = inject('state')
    // 新的响应式
    const viewName = ref('default')

    const currentLocation = computed(() => {
      // 对象的反向解构， 具体是不是叫这个名字来着？
      const { matched, ...rest } = route
      return rest
    })

    function flushWaiter() {
      scrollWaiter.flush()
    }

    function setupWaiter() {
      scrollWaiter.add()
    }

    // 计算属性。另一点是，this.$route.params.id 变成了 route.value.params.id
    const nextUserLink = computed(
      () => '/users/' + String((Number(route.value.params.id) || 0) + 1)
    )

    return {
      currentLocation,
      nextUserLink,
      state,
      flushWaiter,
      setupWaiter,
      viewName,
      toggleViewName() {
        viewName.value = viewName.value === 'default' ? 'other' : 'default'
      },
    }
  },
})
</script>
