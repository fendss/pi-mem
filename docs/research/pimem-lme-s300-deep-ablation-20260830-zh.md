# PiMem 在 MemoryAgentBench LongMemEval-S 300 上的深入消融

日期：2026-08-30

## 一句话结论

这轮实验否定了我们此前最担心的假设：**当前瓶颈不是 Agent 缺少 CandidateSet 式复杂工具，也不是算子无法自由组合。**

真正的问题分成两层：

1. `search` 层已经表达了大部分正确语义，但物理召回池太浅、结构化约束没有下推；
2. `read` 层把探索性读取不可逆地提交为最终证据，导致困难题的 ledger 过大，后续 summary 被噪声、旧状态和重复事件带偏。

反事实重答进一步支持第二点：在 13 道“gold 已全部提交但回答错误”的题上，移除 retrieval summary 后恢复 5 道；再把输入缩成 gold-only exact evidence 后恢复 9 道。它不是端到端分数，但说明错误并不只在 answer model：summary 锚定和 ledger 噪声都在制造可观测损失。

因此，下一步不应增加 Agent-facing 工具，也不应继续给 Skill 填题型规则。应该保持：

```text
search -> read -> finish
```

只在 harness 内部把“宽召回、窄展示、证据提交”三个状态真正分开。

## 1. 实验对象与可信边界

本报告锁定 `inline-compose-v2`：

- MemoryAgentBench LongMemEval-S：300 题；
- retrieval Agent：GPT-5-mini，medium reasoning；
- answer model：GPT-5-mini，medium reasoning；
- 最多 8 次 semantic search；
- judge：GPT-4o，MemoryAgentBench 官方 prompt；
- 最终得分：239/300，即 79.67%。

历史最佳在相同 GPT-4o prompt 对重合 300 题重判为 255/300，但它与当前版本并非严格受控 A/B：两者的 memory scope、ingestion、宏算子、搜索预算不同，且 176/300 题的 question date 不同。因此，`255 -> 239` 只用于诊断，不能归因给某一项代码改动。

### 1.1 先修复审计污染

多轮实验复用了同一个 `wrap-audits.jsonl`。旧诊断脚本只按 question 文本保留最后一条轨迹，会把当前答案与后续 hierarchical 实验的检索轨迹拼接。

本次按 `[2026-08-30T11:05:00Z, 11:19:00Z)` 切分，301 次 attempt 中每题只保留最后一次有效重试，得到恰好 300 条 clean audit。污染产物已改名为 `pipeline-diagnostic.INVALID-shared-log-contaminated.json`，后续所有数字只使用 clean 文件。

## 2. 错误瀑布不是四种等价的“算子错误”

排除 30 道 preference 后，当前共有 44 道错题：

| 轨迹阶段 | 题数 | 可以支持的判断 |
|---|---:|---|
| gold 未完整进入 candidate | 20 | 候选召回或曝光不足 |
| gold 已进入 candidate，但未全部 commit | 6 | 可能是 read/选择问题，需逐题验证 |
| gold 已全部 commit，但答案错 | 13 | 召回已成功，错误发生在证据合成或 answer |
| 否定/不存在问题，无正向 gold | 5 | 正向 source recall 不适用 |

20 道召回不完整题中，multi-session 8、temporal 9、single-session-user 2、knowledge-update 1。它们平均只执行 1.8 次 semantic search；16/20 从未调用 `search_more`，另 4 题也只翻了一页。

## 3. 消融一：Agent 是否真的缺少候选集组合能力？

### 实验动机

检验此前的架构假设：如果普通 corpus-first 搜索无法恢复 gold，而“以当前候选为输入”的邻居扩展或二跳搜索可以独占恢复，才有证据把 PiMem 重构为 stateful CandidateSet dataflow。

### 论证逻辑

固定 20 道召回错题，完全复用 Agent 当时生成的 query、role 和 scope，不重新生成查询。Gold ID 只在运行后评分，不参与普通 arm。依次测试：

- hybrid / lexical 深度 20、40、60、80、100；
- 每条 query 独立检索后 union 或固定预算 RRF；
- session breadth；
- 当前候选的同 session 邻居；
- 用当前候选原文做第二次 corpus retrieval；
- 仅用于上界的 oracle rerank。

### 实验效果

| Arm | gold 全覆盖 | 平均候选数 |
|---|---:|---:|
| 实际 search 暴露 | 0/20 | 28.50 |
| 实际 retrieval，含 read expansion | 0/20 | 33.35 |
| hybrid top-20 | 3/20 | 24.25 |
| lexical top-20 | 6/20 | 24.50 |
| hybrid top-40 | 12/20 | 47.90 |
| hybrid top-60 | 15/20 | 70.85 |
| hybrid top-80 | 17/20 | 92.70 |
| hybrid top-100 | 17/20 | 114.40 |
| per-query hybrid top-100 unbounded union | 19/20 | 268.50 |
| 同一深池 RRF top-20 | 3/20 | 20.00 |
| 同一深池 RRF top-40 | 10/20 | 40.00 |
| maxPerSession=1, hybrid top-20 | 4/20 | 24.95 |
| top-10 anchors 的 ±2 turn 邻居 | 3/20 | 52.45 |
| anchor-content 二次 hybrid | 3/20 | 36.15 |

结果分三层：

1. **17/20 只是深度问题。** 同一批 Agent query 在 top-80 已能找全，不需要新查询或候选依赖程序。
2. **2/20 是长尾压缩问题。** siblings 与 kitchen-items 的遗漏 source 分别只在宽 union 第 156、143 位出现；RRF top-40 仍会删除它们。宽池可达不等于能形成可用的 20 条 observation。
3. **1/20 是 metadata routing。** smoker 题中 Agent 已生成 `2023-03-15`。只把这个既有日期下推为 record timestamp 的当日范围，不增加任何 gold 词，hybrid top-20 即在第 4 位召回 gold。

邻居和候选二跳都没有独占恢复任何题：

```text
candidate_dependent_only = 0 / 20
```

Agent 也并非完全没有调用组合：当前 300 条轨迹中有 200 条使用 inline composition，组合轨迹正确率 81%，简单轨迹为 77%。这只是难度混杂下的相关性，不能当作组合的因果增益；但它与上面的 `0/20` 一起说明，当前没有证据把主要损失归因于“Agent 无法操作 CandidateSet”。

所以，现有实验不支持 CandidateSet 工具重构。它支持的是一个内部物理执行层：宽召回、metadata pushdown、窄 evidence view。

## 4. 消融二：6 道 candidate-not-committed 真的是 6 道选择错误吗？

不是。

这 6 题遗漏的 7 个 gold group 的 preview 全部已经对 Agent 可见，位置也不深；但逐题因果只有 3 题是“补读遗漏 gold 可直接恢复”：

| 题目 | 轨迹事实 | 因果归类 |
|---|---|---|
| 5K 用时 | 正确 35 分钟在候选第 8 位，Agent 误读另一条 27:12 | 真正 evidence selection 错 |
| Tom vs Mark/Sarah | 更早的 Tom 事件在候选第 7 位，Agent 读了另一次较晚 Tom 会面 | 真正跨 session 事件选择错 |
| Rachel relocation | 最新 suburbs 在候选第 2 位，Agent 只提交旧状态 Chicago | 真正 knowledge-update 选择错 |
| 社媒增长 | 已读 Twitter +120 与 TikTok +200；finish summary 明确写 TikTok 最大，answer 却输出 Twitter | answer 违背 handoff；漏 Facebook 非因果 |
| 自行车支出 | ledger 已列齐 120+25+40=185，answer 输出 `At least $185` | coverage 过度保守/表达问题 |
| workshop 支出 | 金额事实已齐，summary 错误解释四个月时间窗 | 证据合成错误 |

所以 oracle 选择 gold 虽可把形式上的 `selected_gold_all` 从 0/6 变成 6/6，但可以确认的真实端到端选择收益只有 3/6。

## 5. 消融三：13 道 gold-committed 错题是不是 answer model 的锅？

也不是。

逐题对照 finish summary、exact sources 和最终 answer：

- 纯 answer 反答：1/13；
- answer 表达粒度 / judge 边界：1/13；
- summary 在 answer 前已经产生错误或不确定结论：11/13。

11 题的通用错误包括：

- 同一实体的旧/新状态没有做 latest-state 解析；
- 重复事件或同值证据被重复计数；
- 时间窗口、相对时间和跨 source 数值没有正确合成；
- 相关但不满足谓词的来源被纳入 ledger；
- 已经有完整事实，仍因为开放世界不确定性输出 `at least`。

answer handoff 本身没有丢数据：19/19 检查题的 prompt 都含 exact committed sources 和 navigation-only summary。绝大多数 answer 只是忠实复述了上游错误 summary。

### 5.1 噪声对照

与 188 道非 preference、gold-committed 且正确的题相比：

| 指标 | 13 道错题 | 188 道正确题 |
|---|---:|---:|
| 平均 committed memories | 11.38 | 5.31 |
| 平均 answer prompt 字符 | 15,723 | 7,958 |
| finish=insufficient | 9/13 | 25/188 |
| direct-read 中位数 | 5 | 2 |

错误组提交证据数是正确组的 2.14 倍，prompt 约为 1.97 倍。额外噪声主要来自 Agent 主动 direct-read，而不是 context expansion：错误组的 expansion 比例反而更低。因此，没有证据支持简单关闭 passage 或邻居扩展。

### 5.2 反事实重答：summary 与 ledger 噪声分别造成多少损失？

对这 13 道题保持 answer model 和官方 judge 不变，构造两条新臂：

- B：保留当前 Agent 已提交的全部 exact sources，只移除 retrieval summary；
- C：仅保留事后映射的 gold exact parents，并移除 retrieval summary。C 只用于诊断上界，不能作为可部署方法。

| 输入臂 | GPT-4o 官方判分 | 相对原轨迹 |
|---|---:|---:|
| 原轨迹：当前 committed sources + summary | 0/13 | — |
| B：当前 committed sources，无 summary | 5/13 | +5 |
| C：gold-only exact sources，无 summary | 9/13 | +9 |

B 与 C 使用同一批 GPT-5-mini medium answer 调用：两臂都正确 4 题，仅 B 正确 1 题，仅 C 正确 5 题，两臂都错 3 题。C 平均只传 2.23 条来源、1,479 个字符；B 为 11.38 条、15,185 个字符，即来源缩小 5.1 倍、prompt 缩小 10.3 倍。

这个结果支持两个相互独立的机制：

1. 去掉 summary 后已经能恢复一部分题，说明自由文本 synthesis 会把 answer 锚定到错误结论；
2. 在同样没有 summary 时，C 相对 B 净恢复 4 题（C-only 5、B-only 1），说明不可逆提交的无关/冲突证据还会额外伤害回答。

官方 9/13 也不是纯 answer 能力的绝对上界。人工复核 C 的 4 个失败中：1 题确为数值比较推理错；1 题是 absence 问题，单条正向 gold 本就不能证明 Tom 没出现；另 2 题分别回答了 `Three weddings` 和 `Three doctors`，数量与问题一致，却因未附 reference 中的名称/类型被官方 judge 判错。按问题语义审计，C 为 11/13。

需要保留一个重要限制：本次没有重新采样一条 fresh A，因此 B 相对历史原轨迹的 `+5` 混有模型采样方差；B/C 是同批配置下的更直接对照，但也不是同一个生成样本。最稳健的因果信号是 B/C 之间的净降噪差，而不是把 5/13 直接宣称为 summary 的确定增益。

## 6. 代码层根因

当前实现明确把 `read` 定义为 evidence-selection boundary：

- `MemoryLedger.recordRead()` 将每次 exact read 永久写入 `evidenceById`；
- `finish` 自动把 ledger 中每一条 read source 全部提交给 answer；
- Agent 没有办法丢弃探索性 read。

这在简单题上降低了工具负担，但在困难题上把“看一下是否相关”和“确认它是最终证据”错误地合并成同一个不可逆动作。上述 2.14 倍 ledger 噪声就是这一设计假设失效的直接观测。

另一方面，代码已经有 `search_more` 的 20 -> 40 -> 80 continuation，并且不消耗新的 semantic-search budget。17/20 的离线恢复深度正好落在这个范围内；问题不是缺 API，而是 16/20 错题没有继续翻页。这是 stopping / sufficiency calibration，而不是 operator expressivity。

## 7. 与历史最佳的关系

同一 300 题 ID 的 judge 对拍为：

| 变化 | 数量 |
|---|---:|
| 两版都正确 | 219 |
| 两版都错误 | 25 |
| 历史正确、当前错误 | 36 |
| 历史错误、当前正确 | 20 |

净变化为 -16，对应 255 -> 239。36 道 regression 中，非 preference 有 28 道：12 道 recall、4 道 candidate 可见但未提交、7 道 gold 已提交但回答错、5 道否定题。

这说明当前不是整体失效，而是在增加 20 道收益的同时又引入了更大的候选曝光与证据选择波动。由于实验条件不完全一致，这一对拍只能作为定位线索，不能写成论文中的因果消融。

## 8. 下一步架构决策

### 8.1 保持 Agent-facing 协议不变

不增加 recall/expand/refine/CandidateSet 等工具。Agent 仍只需要：

```text
search -> read -> finish
```

### 8.2 在 search 内部分离宽池与可见页

```text
Agent semantic query
  -> physical planner
      -> dense / lexical query-local wide recall
      -> verified metadata constraint branch
  -> hidden candidate reservoir
  -> bounded visible page
  -> search_more
```

现阶段不能直接宣称需要 learned reranker。RRF top-20/40 已证明机械压缩会丢长尾。下一步应在 held-out memory scope 上比较现有 joint rank、RRF、max-score 和通用 question-conditioned selector；selector 不看 gold，并且始终只暴露约 20 条。

### 8.3 重新分开 inspect 与 commit，但不增加新工具

最小方案不是再加一个 `commit` 工具，而是：

- `read` 只产生稳定 `E` 引用和 exact observation；
- `finish` 只提交一个很短的 `evidenceRefs` 列表；
- citation、hash、provenance 和格式仍由 harness 自动生成。

这样只增加一次最终 ref 选择，不要求模型手写 citation，也不会把整个 raw memory 留在模型历史中。其认知成本小于让 answer model 在 11 条互相冲突的来源里重新清理证据。

### 8.4 降低 summary 的认知权威

working memory 可以继续服务 retrieval 决策，但 answer handoff 不应把自由文本 summary 当作事实结论。本轮反事实已经观察到：去 summary 的 B 为 5/13，gold-only 且去 summary 的 C 为 9/13。

下一步不是继续增强 summary 推理，而是把它收缩成结构化 source map：每个 requested slot 只指向若干 `E` 引用，不输出自由文本最终结论。正式受控实验仍需 fresh A/B/C 同批多次采样，确认去 summary 的收益不是随机波动。

### 8.5 优先级

1. **先改 evidence transaction：** `read` 只 inspect，`finish(evidenceRefs)` 才 commit；
2. **再改 search physical planner：** query-local 宽召回、metadata pushdown、约 20 条窄展示；
3. **最后评估通用 selector：** 必须不看 gold，并在 held-out scope 与其他 benchmark 上验证；
4. **暂不增加新算子或 Skill 题型规则：** 当前没有 CandidateSet dataflow 的实验必要性。

## 9. 论文故事应如何收敛

当前证据支持的不是“Agent 自由合成越来越复杂的检索算子”，而是：

> PiMem 将 Agent 的语义检索意图与 memory-specific 的物理执行和证据事务分离。Agent 表达需要什么；harness 负责宽召回、元数据下推、有界展示和可验证的最小证据提交。

这个故事仍然回到 PiMem 本身：创新点不是多几个 tool，也不是用 Skill 模拟 SQL，而是让同一个简单逻辑协议在不同 memory backend 上编译成高召回、低噪声、可审计的执行过程。

## 10. 限制

- 召回消融条件化在 20 道已知 recall 错题上，不等于最终 accuracy 增益；
- per-query top-100 union 的 19/20 是可达性上界，不是可部署方法；
- 日期下推目前只有一个严格反例，不能宣称已经解决 temporal；
- gold source 映射只用于事后评分，oracle rerank 不可作为方法结果；
- B 没有 fresh A，且 B/C 都是单次随机生成；反事实重答只用于机制诊断；
- gold-only C 对 absence 问题并不构成完整充分证据，官方 judge 还存在答案粒度边界；
- 当前 artifact 没有记录 source commit / harness fingerprint，这是复现性缺口；
- 下一轮架构改动必须在 held-out context 和其他 memory benchmark 上验证，不能继续围绕这 20 题调规则。

## 11. 产物

- clean audit：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/inline-compose-v2-wrap-audits.clean.jsonl`
- clean pipeline：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/pipeline-diagnostic.inline-compose-v2.clean.json`
- recall v3：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/oracle-retrieval-ablation.nonpref-wrong20.v3.json`
- metadata counterfactual：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/smoker-date-window-counterfactual.json`
- evidence re-answer summary：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-evidence-reanswer-20260830/summary.json`
- evidence re-answer manifest：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-evidence-reanswer-20260830/run-manifest.json`
- evidence re-answer raw results：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-evidence-reanswer-20260830/answer-results.json`
- 可复现 runner：`integrations/memoryagentbench/research/oracle_retrieval_ablation.mjs`
- runner 说明与独立召回报告：`integrations/memoryagentbench/research/README.md`、`integrations/memoryagentbench/research/oracle-retrieval-ablation-report-zh.md`
