import { RouteParams, RouteComponent, RouteParamsRaw } from '../types'
import { hasSymbol } from '../injectionSymbols'

export * from './env'

export function isESModule(obj: any): obj is { default: RouteComponent } {
  return obj.__esModule || (hasSymbol && obj[Symbol.toStringTag] === 'Module')
}

// 使用 Object.assign 而不用解解构、扩展应该是为了浏览器的兼容性
export const assign = Object.assign

export function applyToParams(
  fn: (v: string | number) => string,
  params: RouteParamsRaw | undefined
): RouteParams {
  const newParams: RouteParams = {}

  for (const key in params) {
    const value = params[key]
    newParams[key] = Array.isArray(value) ? value.map(fn) : fn(value)
  }

  return newParams
}

export let noop = () => {}
