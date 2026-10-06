import { describe, expect, it } from 'vitest'
import { defaultProtocolForModel, findBuiltinModel, recommendCatalogMetadata } from '../model-catalog-inventory'

/*
 * 「厂商默认协议」这张表钉的是规则本身,不是某一行的取值 ——
 * 它被三处消费(种子 / 拉取列表 / 老库回填),这里防的是「表被改空或匹配
 * 悄悄失效」之后,三个入口各自回到「跟随供应商」而无人报错。
 */
describe('厂商默认协议', () => {
  it('claude 系模型默认走 anthropic 线形,聚合站前缀 ID 与裸名等价', () => {
    expect(defaultProtocolForModel('claude-fable-5-1')).toBe('anthropic')
    expect(defaultProtocolForModel('claude-opus-5')).toBe('anthropic')
    expect(defaultProtocolForModel('anthropic/claude-fable-5-1')).toBe('anthropic')
    // ★ 点号拼写是预设侧真实在用的形式(anthropic / openrouter 的 suggestedModels),
    // 漏登记的话这两处错过目录 —— 元数据和协议钉一起失效
    expect(defaultProtocolForModel('claude-fable-5.1')).toBe('anthropic')
    expect(defaultProtocolForModel('anthropic/claude-fable-5.1')).toBe('anthropic')
    expect(defaultProtocolForModel('claude-opus-4.8')).toBe('anthropic')
  })

  it('未登记厂商与目录外模型返回 undefined,含义是跟随供应商协议', () => {
    expect(defaultProtocolForModel('gpt-5.6-sol')).toBeUndefined()
    expect(defaultProtocolForModel('glm-5.3')).toBeUndefined()
    expect(defaultProtocolForModel('deepseek-v4-pro')).toBeUndefined()
    expect(defaultProtocolForModel('totally-unknown-model')).toBeUndefined()
  })
})

/*
 * 「添加自定义模型」表单反查预填 —— recommendCatalogMetadata 把目录行里
 * 可安全继承的元数据挑出来,同时**不**泄漏身份/证据字段(id、aliases、
 * source、requestAdapter)。命名空间前缀已由 findBuiltinModel 覆盖。
 */
describe('目录元数据推荐 · recommendCatalogMetadata', () => {
  it('命中时窗口/输出上限与目录一致', () => {
    const recommended = recommendCatalogMetadata('deepseek-v4-flash')
    const known = findBuiltinModel('deepseek-v4-flash')
    expect(recommended).toBeDefined()
    expect(recommended?.contextWindow).toBe(known?.contextWindow)
    expect(recommended?.maxOutputTokens).toBe(known?.maxOutputTokens)
  })

  it('命名空间前缀命中,带回思考线形', () => {
    expect(recommendCatalogMetadata('cn:hy3')).toMatchObject({
      contextWindow: 262_144,
      maxOutputTokens: 131_072,
      thinkingConfig: { mode: 'effort' },
    })
  })

  it('未命中返回 undefined', () => {
    expect(recommendCatalogMetadata('cn:not-a-model')).toBeUndefined()
  })

  it('不泄漏身份与证据字段', () => {
    const recommended = recommendCatalogMetadata('hy3')
    expect(recommended).not.toHaveProperty('id')
    expect(recommended).not.toHaveProperty('aliases')
    expect(recommended).not.toHaveProperty('source')
    expect(recommended).not.toHaveProperty('requestAdapter')
  })

  it('capabilities 与目录常量拷贝隔离', () => {
    expect(recommendCatalogMetadata('hy3')!.capabilities).not.toBe(
      findBuiltinModel('hy3')!.capabilities,
    )
  })
})
