import { reactive } from 'vue'

// reactive 与 ref 观察一个对象有什么区别？
export const globalState = reactive({
  cancelNextNavigation: false,
})
